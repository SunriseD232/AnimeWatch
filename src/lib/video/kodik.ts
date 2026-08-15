import { getCachedJson } from '@/lib/cache/apiCache';
import type {
  EmbedResult,
  GetEmbedParams,
  Translation,
  VideoSource,
} from './types';
import type { OwnPlayerTranslation } from '@/lib/extract/types';

/**
 * Источник видео на базе Kodik.
 *
 * Режим A (есть KODIK_TOKEN): поиск embed через kodikapi.com/search —
 *   отдаёт реальную ссылку плеера, список серий и озвучек.
 * Режим B (нет токена): конструируем публичный find-player iframe как fallback.
 *
 * Класс исполняется ТОЛЬКО на сервере (токен не должен утекать в браузер).
 */

// Актуальный домен API Kodik — с дефисом (старый kodikapi.com больше не резолвится).
const KODIK_API = 'https://kodik-api.com/search';
// См. VS_FETCH_TIMEOUT_MS в videoseed-catalog.ts — без таймаута зависший
// апстрим вешает страницу тайтла/просмотра целиком.
const KODIK_FETCH_TIMEOUT_MS = 8_000;

interface KodikTranslation {
  id: number;
  title: string;
  type: string;
}

interface KodikSearchItem {
  link: string;
  title: string;
  type: string;
  translation: KodikTranslation;
  episodes_count?: number;
  last_episode?: number;
  seasons?: Record<
    string,
    { episodes?: Record<string, string | { link: string }> }
  >;
}

interface KodikSearchResponse {
  total: number;
  results: KodikSearchItem[];
}

/** Добавляет query-параметры к возможно протокол-относительному URL. */
function withParams(
  rawUrl: string,
  params: Record<string, string | number | undefined>,
): string {
  const base = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  // Возвращаем протокол-относительный вид, если исходный был таким.
  return rawUrl.startsWith('//')
    ? url.toString().replace(/^https:/, '')
    : url.toString();
}

/**
 * Общий поиск Kodik по kinopoisk_id/shikimori_id — используется и
 * KodikVideoSource.searchMode (embed для вкладки Kodik), и
 * getKodikOwnPlayerTranslations (список озвучек для «Наш плеер») — раньше
 * это были два независимых fetch на один и тот же URL, теперь один
 * общекэшируемый (см. getCachedJson) на оба случая.
 */
async function fetchKodikSearch(
  token: string,
  idParam: { kinopoiskId?: number; shikimoriId?: number },
): Promise<KodikSearchResponse> {
  const search = new URLSearchParams({ token, with_episodes: 'true' });
  let cacheKey: string;
  if (idParam.kinopoiskId != null) {
    search.set('kinopoisk_id', String(idParam.kinopoiskId));
    cacheKey = `kodik:search:kp:${idParam.kinopoiskId}`;
  } else {
    search.set('shikimori_id', String(idParam.shikimoriId));
    cacheKey = `kodik:search:shiki:${idParam.shikimoriId}`;
  }

  return getCachedJson(cacheKey, 600, async () => {
    const res = await fetch(`${KODIK_API}?${search.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(KODIK_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Kodik API error ${res.status}`);
    return (await res.json()) as KodikSearchResponse;
  });
}

export class KodikVideoSource implements VideoSource {
  constructor(private readonly token: string | undefined) {}

  async getEmbedUrl(params: GetEmbedParams): Promise<EmbedResult> {
    if (this.token) {
      try {
        return await this.searchMode(params);
      } catch {
        // Если API недоступен — деградируем до fallback.
        return this.fallbackMode(params);
      }
    }
    return this.fallbackMode(params);
  }

  /** Режим A: реальный поиск через Kodik API. */
  private async searchMode(
    params: GetEmbedParams,
  ): Promise<EmbedResult> {
    const {
      shikimoriId,
      kinopoiskId,
      season,
      episode,
      translationId,
      startFrom,
    } = params;

    // Кино ищем по kinopoisk_id, аниме — по shikimori_id.
    const data = await fetchKodikSearch(this.token as string, {
      kinopoiskId: kinopoiskId ?? undefined,
      shikimoriId: kinopoiskId == null ? shikimoriId : undefined,
    });
    if (!data.results || data.results.length === 0) {
      throw new Error('Kodik: пустой результат');
    }

    // Собираем список уникальных озвучек.
    const translationMap = new Map<number, Translation>();
    for (const item of data.results) {
      if (item.translation) {
        translationMap.set(item.translation.id, {
          id: item.translation.id,
          title: item.translation.title,
          type: item.translation.type,
        });
      }
    }
    const translations = Array.from(translationMap.values());

    // Выбираем результат по озвучке (или первый доступный).
    const chosen =
      (translationId
        ? data.results.find(
            (r) => r.translation?.id === translationId,
          )
        : undefined) ?? data.results[0];

    const episodesTotal =
      chosen.episodes_count ?? chosen.last_episode ?? null;

    const embedUrl = withParams(chosen.link, {
      // Сезон передаём только для сериалов кино (season > 1 либо явно задан).
      season: season && season > 0 ? season : undefined,
      episode,
      start_from: startFrom,
    });

    return {
      embedUrl,
      translations,
      episodesTotal,
      fallback: false,
    };
  }

  /** Режим B: публичный find-player по внешнему id. */
  private fallbackMode(params: GetEmbedParams): EmbedResult {
    const { shikimoriId, kinopoiskId, season, episode, startFrom } = params;
    const embedUrl = withParams(
      '//kodik.info/find-player',
      {
        shikimoriID: kinopoiskId != null ? undefined : shikimoriId,
        kinopoiskID: kinopoiskId,
        season: season && season > 0 ? season : undefined,
        episode,
        start_from: startFrom,
      },
    );
    return {
      embedUrl,
      translations: [],
      episodesTotal: null,
      fallback: true,
    };
  }
}

/** Фабрика активного источника видео (сервер). */
export function createVideoSource(): VideoSource {
  return new KodikVideoSource(process.env.KODIK_TOKEN);
}

/**
 * Все озвучки Kodik для тайтла кино по kinopoisk_id, в форме, понятной
 * OwnPlayer/resolveStream — аналог getYummyEpisode() для аниме, только
 * источник данных другой (Kodik ищет по kinopoisk_id напрямую, Yummy кино
 * вообще не индексирует). embedUrl — тот же реальный embed каждой отдельной
 * озвучки (не только выбранной), в отличие от KodikVideoSource.getEmbedUrl().
 */
export async function getKodikOwnPlayerTranslations(
  kinopoiskId: number,
  season: number,
  episode: number,
): Promise<OwnPlayerTranslation[]> {
  const token = process.env.KODIK_TOKEN;
  if (!token) return [];

  let data: KodikSearchResponse;
  try {
    data = await fetchKodikSearch(token, { kinopoiskId });
  } catch {
    return [];
  }
  if (!data.results) return [];

  const seen = new Set<number>();
  const translations: OwnPlayerTranslation[] = [];
  for (const item of data.results) {
    if (!item.translation || !item.link || seen.has(item.translation.id)) continue;
    seen.add(item.translation.id);
    const embedUrl = withParams(item.link, {
      season: season && season > 0 ? season : undefined,
      episode,
    });
    translations.push({
      id: item.translation.id,
      title: `${item.translation.title} · Kodik`,
      embedUrl: embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl,
      source: 'kodik',
    });
  }
  return translations;
}

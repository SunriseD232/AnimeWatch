import type {
  EmbedResult,
  GetEmbedParams,
  Translation,
  VideoSource,
} from './types';

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

    const search = new URLSearchParams({
      token: this.token as string,
      with_episodes: 'true',
    });
    // Кино ищем по kinopoisk_id, аниме — по shikimori_id.
    if (kinopoiskId != null) {
      search.set('kinopoisk_id', String(kinopoiskId));
    } else {
      search.set('shikimori_id', String(shikimoriId));
    }

    const res = await fetch(`${KODIK_API}?${search.toString()}`, {
      // Ответ Kodik по тайтлу стабилен — можно кэшировать ненадолго.
      next: { revalidate: 600 },
    });
    if (!res.ok) throw new Error(`Kodik API error ${res.status}`);

    const data = (await res.json()) as KodikSearchResponse;
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

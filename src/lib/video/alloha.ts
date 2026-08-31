import type { OwnPlayerTranslation } from '@/lib/extract/types';

/**
 * Официальный API Alloha (в отличие от анимного пути через Yummy, см.
 * lib/video/yummy.ts, — здесь прямой платный доступ по токену и по
 * kinopoisk_id, работает и для кино). Один запрос к их API отдаёт список
 * озвучек, который дальше используется ОДНОВРЕМЕННО для двух путей в плеере
 * (см. getAllohaSources ниже — один fetch на оба, а не два отдельных):
 *  1. Родной iframe Alloha — отдельная вкладка «Alloha» в переключателе
 *     (embedUrl), свой собственный селектор качества вплоть до 4K, но
 *     позиция только оценивается (см. useVideoseedEstimator), как у
 *     Videoseed — у их плеера нет postMessage с точным временем.
 *  2. Наше извлечение через VPS Puppeteer (ownPlayerTranslations) —
 *     озвучка в списке «Наш плеер», точный трекинг позиции (нативный
 *     <video>), качество форсируется на максимум самим экстрактором (см.
 *     vps-extractor/src/alloha.js forceHighestQuality).
 *
 * Гео-заблокирована по API-эндпоинту Alloha (без валидного российского IP
 * запрос с токеном не проходит) — раньше это требовало RU-прокси
 * (lib/net/allohaProxy.ts, удалён 2026-08-30), но с переездом сайта на
 * self-host сама VPS уже российская (проверено вживую: прямой curl на
 * api.alloha.tv с VPS отдаёт success без всякого прокси) — прокси стал не
 * нужен ни здесь, ни в vps-extractor (тот же вывод для /bnsi/, см.
 * ARCHITECTURE.md §12.6). Если сайт когда-нибудь снова переедет на
 * инфраструктуру с не-российским IP (как раньше был Vercel) — понадобится
 * восстановить прокси на обоих концах.
 *
 * "ONLY FOR PERSONAL USE" — токены создаются самостоятельно, несколько
 * штук про запас (не все могут быть активны сразу), поэтому пробуем по
 * очереди и останавливаемся на первом, который реально отвечает "success".
 */
const ALLOHA_API = 'https://api.alloha.tv/';
const ALLOHA_TIMEOUT_MS = 10_000;

function tokens(): string[] {
  return [process.env.ALLOHA_TOKEN, process.env.ALLOHA_TOKEN_2].filter(
    (t): t is string => !!t,
  );
}

interface AllohaTranslationEntry {
  name?: string;
  iframe?: string;
  uhd?: boolean;
}

interface AllohaResponse {
  status?: string;
  data?: {
    translation_iframe?: Record<string, AllohaTranslationEntry>;
  };
}

async function fetchWithToken(kinopoiskId: number, token: string): Promise<AllohaResponse | null> {
  try {
    const res = await fetch(`${ALLOHA_API}?token=${token}&kp=${kinopoiskId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ALLOHA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AllohaResponse;
    return data.status === 'success' ? data : null;
  } catch {
    return null;
  }
}

/** Пробует токены по очереди, останавливается на первом рабочем. */
async function fetchAlloha(kinopoiskId: number): Promise<AllohaResponse | null> {
  for (const token of tokens()) {
    const data = await fetchWithToken(kinopoiskId, token);
    if (data) return data;
  }
  return null;
}

type AllohaEntry = [id: string, entry: AllohaTranslationEntry & { iframe: string }];

// Id озвучки в общем плоском списке «Наш плеер» (Kodik + Videoseed + Alloha +
// Real-Debrid, см. resolveCinemaEpisode.ts) должен быть уникален среди ВСЕХ
// источников сразу — активный перевод там ищется одним .find(t => t.id ===
// translationId) по всему списку без учёта source. Id из Alloha — их
// собственные небольшие числа (в духе Kodik: 63, 66, 93, 154...) — вполне
// могут совпасть с Kodik. Смещаем в заведомо свободный диапазон.
const ID_OFFSET = 1_000_000;

export interface AllohaSources {
  /** Для родной вкладки «Alloha» — null, если тайтла нет / токены не сработали. */
  embedUrl: string | null;
  /** Для селектора «Наш плеер». */
  ownPlayerTranslations: OwnPlayerTranslation[];
}

/**
 * Один запрос к Alloha на фильм → сразу оба списка выше. embedUrl — выбор
 * озвучки: сперва дублированная (самый привычный вариант), иначе любая с
 * флагом uhd, иначе первая доступная.
 */
export async function getAllohaSources(kinopoiskId: number): Promise<AllohaSources> {
  if (tokens().length === 0) return { embedUrl: null, ownPlayerTranslations: [] };

  const data = await fetchAlloha(kinopoiskId);
  const entries: AllohaEntry[] = Object.entries(data?.data?.translation_iframe ?? {}).filter(
    (entry): entry is AllohaEntry => !!entry[1].iframe,
  );
  if (entries.length === 0) return { embedUrl: null, ownPlayerTranslations: [] };

  const list = entries.map(([, t]) => t);
  const dubbed = list.find((t) => (t.name ?? '').toLowerCase().includes('дублир'));
  const uhd = list.find((t) => t.uhd);
  const embedUrl = (dubbed ?? uhd ?? list[0]).iframe;

  const ownPlayerTranslations: OwnPlayerTranslation[] = entries.map(([id, t]) => ({
    id: ID_OFFSET + Number(id),
    title: t.uhd ? `${t.name ?? 'Озвучка'} · Alloha · 4K` : `${t.name ?? 'Озвучка'} · Alloha`,
    embedUrl: t.iframe,
    source: 'alloha' as const,
  }));

  return { embedUrl, ownPlayerTranslations };
}

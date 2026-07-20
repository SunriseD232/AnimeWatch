/**
 * YummyAnime (api.yani.tv) — резервный балансер для раздела аниме и источник
 * постеров с лучшим покрытием, чем Shikimori (у него много плейсхолдеров).
 *
 * Публичный API без токена. Отдаёт не прямой поток, а iframe_url на чужие
 * плееры (Kodik/Alloha/Sibnet) — поэтому это именно РЕЗЕРВНЫЙ источник,
 * как Kodik, а не замена AniLibria (прямой HLS, точный трекинг позиции).
 *
 * Матчинг тайтла — точный, по shikimori_id (`?shikimori_ids=`), в отличие от
 * AniLibria, где название приходится сопоставлять эвристикой.
 *
 * Модуль исполняется ТОЛЬКО на сервере.
 */

const BASE = 'https://api.yani.tv';

interface YummyPoster {
  medium?: string;
  big?: string;
  fullsize?: string;
}

interface YummyRemoteIds {
  shikimori_id?: number;
}

interface YummyAnimeListItem {
  anime_id: number;
  poster?: YummyPoster;
  remote_ids?: YummyRemoteIds;
}

interface YummyAnimeListResponse {
  response?: YummyAnimeListItem[];
}

interface YummySkipSegment {
  time: number;
  length: number;
}

interface YummyVideoItem {
  video_id: number;
  iframe_url: string;
  number: string;
  data?: { dubbing?: string; player?: string };
  skips?: { opening?: YummySkipSegment | null; ending?: YummySkipSegment | null };
}

interface YummyVideosResponse {
  response?: YummyVideoItem[];
}

export interface YummyTranslation {
  id: number;
  title: string;
  embedUrl: string;
}

export interface YummyEpisodeData {
  translations: YummyTranslation[];
  skipOpening: YummySkipSegment | null;
  skipEnding: YummySkipSegment | null;
}

/** Протокол-относительный URL (//host/path) → абсолютный (нужен для полей,
 *  которые дальше проходят через imageUrl(), где это единственный кейс без
 *  явного http-префикса). */
function absolutize(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url;
}

async function yummyFetch<T>(path: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Резолвит внутренний anime_id Yummy по shikimori_id. null — тайтла нет в каталоге. */
async function resolveYummyAnimeId(shikimoriId: number): Promise<number | null> {
  const data = await yummyFetch<YummyAnimeListResponse>(
    `/anime?shikimori_ids=${shikimoriId}&limit=1`,
    3600,
  );
  return data?.response?.[0]?.anime_id ?? null;
}

/** Есть ли в записи хоть один валидный сегмент пропуска. */
function skipScore(item: YummyVideoItem): number {
  return (item.skips?.opening ? 1 : 0) + (item.skips?.ending ? 1 : 0);
}

/**
 * Данные эпизода: переводы (для резервного плеера) + тайминги пропуска
 * опенинга/эндинга (для кнопки на AniLibria-плеере).
 *
 * Переводы дедуплицируются по iframe_url — некоторые балансеры (Alloha)
 * отдают один и тот же embed под разными подписями озвучки (выбор дорожки
 * там происходит уже внутри их собственного плеера).
 */
export async function getYummyEpisode(
  shikimoriId: number,
  episode: number,
): Promise<YummyEpisodeData | null> {
  const animeId = await resolveYummyAnimeId(shikimoriId);
  if (!animeId) return null;

  const data = await yummyFetch<YummyVideosResponse>(
    `/anime/${animeId}/videos`,
    600,
  );
  const items = (data?.response ?? []).filter(
    (it) => String(it.number) === String(episode),
  );
  if (items.length === 0) return null;

  const seenUrls = new Set<string>();
  const translations: YummyTranslation[] = [];
  for (const it of items) {
    if (!it.iframe_url || seenUrls.has(it.iframe_url)) continue;
    seenUrls.add(it.iframe_url);
    const dub = it.data?.dubbing || 'Озвучка';
    const player = it.data?.player || '';
    translations.push({
      id: it.video_id,
      title: player ? `${dub} · ${player.replace(/^Плеер\s*/i, '')}` : dub,
      embedUrl: it.iframe_url,
    });
  }
  if (translations.length === 0) return null;

  // Тайминги пропуска: приоритет строке с озвучкой AniLibria (максимально
  // совпадает по монтажу с нашим прямым HLS-потоком того же источника),
  // иначе — любая строка с наиболее полными данными.
  const byAniLibria = items
    .filter((it) => (it.data?.dubbing || '').toLowerCase().includes('anilibria'))
    .sort((a, b) => skipScore(b) - skipScore(a))[0];
  const bestOverall = [...items].sort((a, b) => skipScore(b) - skipScore(a))[0];
  const skipSource =
    byAniLibria && skipScore(byAniLibria) > 0 ? byAniLibria : bestOverall;

  return {
    translations,
    skipOpening: skipSource?.skips?.opening ?? null,
    skipEnding: skipSource?.skips?.ending ?? null,
  };
}

/**
 * Батч-резолвер постеров: shikimori_id → абсолютный URL постера Yummy.
 * Один запрос на весь список (страница/поиск/детали), без обрезки по
 * лимиту. Тайтлы, которых нет в каталоге Yummy, просто отсутствуют в Map —
 * вызывающий код должен сам делать fallback на постер Shikimori.
 */
export async function getYummyPostersMap(
  shikimoriIds: number[],
): Promise<Map<number, string>> {
  const ids = [...new Set(shikimoriIds)].filter(
    (n) => Number.isFinite(n) && n > 0,
  );
  const map = new Map<number, string>();
  if (ids.length === 0) return map;

  const data = await yummyFetch<YummyAnimeListResponse>(
    `/anime?shikimori_ids=${ids.join(',')}&limit=${ids.length}`,
    3600,
  );
  for (const item of data?.response ?? []) {
    const sid = item.remote_ids?.shikimori_id;
    const poster =
      item.poster?.medium || item.poster?.big || item.poster?.fullsize;
    if (sid && poster) map.set(sid, absolutize(poster));
  }
  return map;
}

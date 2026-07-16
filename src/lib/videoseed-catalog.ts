/**
 * Каталог фильмов и сериалов поверх Videoseed API v2 (apiv2.php).
 *
 * Videoseed отдаёт заметно больше контента (особенно сериалов), чем Kodik,
 * поэтому раздел «Фильмы и сериалы» берёт список/поиск/карточку отсюда.
 * Плеер при этом остаётся прежним: Videoseed (embed_auto) как основной и Kodik
 * как второстепенный — оба ищут видео по kinopoisk_id.
 *
 * Внешний id раздела кино — kinopoisk_id (`id_kp`): по нему открывается плеер и
 * он же пишется в watch_progress.shikimori_id при content_type='cinema'.
 * У Videoseed id_kp есть практически у всего контента; элементы без него
 * пропускаем (по ним не построить ни плеер, ни прогресс).
 *
 * ВНИМАНИЕ: у API есть квота запросов (поле requests_available убывает), поэтому
 * ответы агрессивно кэшируются через next.revalidate.
 *
 * Модуль исполняется ТОЛЬКО на сервере (токен не должен утекать в браузер).
 */

const VIDEOSEED_API = 'https://api.videoseed.tv/apiv2.php';

interface VsRawSeason {
  name?: string;
  total_videos?: number | string;
  videos?: Record<string, unknown>;
}

interface VsRawItem {
  name?: string;
  original_name?: string;
  year?: string;
  id?: string;
  id_kp?: string | null;
  id_imdb?: string | null;
  id_tmdb?: string | null;
  poster?: string;
  description?: string;
  genre?: string; // жанры через запятую
  country?: string; // страны через запятую
  type?: string; // 'movie' | 'serial'
  time?: string; // длительность «ЧЧ:ММ» (у сериала — суммарная по всем сериям)
  total_videos?: number | string; // всего видео (для сериалов)
  seasons?: Record<string, VsRawSeason>; // сезоны (в детальном ответе)
}

interface VsResponse {
  status?: string;
  data?: VsRawItem[];
  total?: string;
}

/** Краткая карточка фильма/сериала (каталог, поиск). */
export interface CinemaShort {
  /** kinopoisk_id — используется в роутах и в прогрессе. */
  id: number;
  title: string;
  poster: string | null;
  year: number | null;
  kind: string | null;
  isSerial: boolean;
  rating: number | null;
}

/** Сезон сериала: номер и число серий (нумерация 1..episodes внутри сезона). */
export interface SeasonInfo {
  season: number;
  episodes: number;
}

/** Полная карточка (страница тайтла). */
export interface CinemaFull extends CinemaShort {
  description: string | null;
  /** Всего серий во всём тайтле (сумма по сезонам). */
  episodesTotal: number;
  /** Сезоны сериала. Для фильма — пустой массив. */
  seasons: SeasonInfo[];
  /**
   * Длительность фильма в секундах (null для сериалов: у них поле time в API —
   * суммарная длительность всех серий, а не одной).
   */
  durationSeconds: number | null;
  genres: string[];
  countries: string[];
}

function token(): string | undefined {
  return process.env.VIDEOSEED_API_TOKEN;
}

async function vsFetch(
  params: Record<string, string>,
  revalidate: number,
): Promise<VsRawItem[]> {
  const t = token();
  if (!t) return []; // без токена каталог пуст — страница покажет заглушку
  const search = new URLSearchParams({ token: t, ...params });
  const res = await fetch(`${VIDEOSEED_API}?${search.toString()}`, {
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`Videoseed API error ${res.status}`);
  const data = (await res.json()) as VsResponse;
  if (data.status && data.status !== 'success') {
    throw new Error(`Videoseed API status: ${data.status}`);
  }
  return data.data ?? [];
}

/** Разбивает строку «А, Б, В» в массив без пустых значений. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isSerialType(type: string | undefined): boolean {
  return type === 'serial';
}

/** Длительность «ЧЧ:ММ» (или «ЧЧ:ММ:СС») → секунды. */
function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [h, m, s = 0] = parts;
  const seconds = h * 3600 + m * 60 + s;
  return seconds > 0 ? seconds : null;
}

/** Число серий в сезоне: приоритет total_videos, иначе размер videos. */
function seasonEpisodeCount(season: VsRawSeason): number {
  const tv = Number(season.total_videos);
  if (Number.isFinite(tv) && tv > 0) return tv;
  const videos = season.videos ? Object.keys(season.videos).length : 0;
  return videos > 0 ? videos : 1;
}

/** Разбирает объект seasons Videoseed в упорядоченный список сезонов. */
function parseSeasons(item: VsRawItem): SeasonInfo[] {
  const raw = item.seasons;
  if (!raw) return [];
  return Object.entries(raw)
    .map(([key, season]) => ({
      season: Number(key),
      episodes: seasonEpisodeCount(season),
    }))
    .filter((s) => Number.isFinite(s.season) && s.season > 0)
    .sort((a, b) => a.season - b.season);
}

function toShort(item: VsRawItem): CinemaShort | null {
  const kpId = Number(item.id_kp);
  // Без kinopoisk_id не сможем ни искать видео, ни хранить прогресс.
  if (!Number.isFinite(kpId) || kpId <= 0) return null;
  const poster = item.poster ?? null;
  if (!poster) return null;

  const year = Number(item.year);

  return {
    id: kpId,
    title: item.name || item.original_name || 'Без названия',
    poster,
    year: Number.isFinite(year) && year > 0 ? year : null,
    kind: isSerialType(item.type) ? 'Сериал' : 'Фильм',
    isSerial: isSerialType(item.type),
    // Videoseed API не отдаёт рейтинг — карточка просто не покажет бейдж.
    rating: null,
  };
}

/**
 * Дедуп по kinopoisk_id (одна единица контента может встретиться в нескольких
 * ответах). Берём первый валидный вариант, сохраняя исходный порядок.
 */
function dedupe(items: VsRawItem[], limit: number): CinemaShort[] {
  const seen = new Set<number>();
  const out: CinemaShort[] = [];
  for (const item of items) {
    const short = toShort(item);
    if (!short || seen.has(short.id)) continue;
    seen.add(short.id);
    out.push(short);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Главная раздела кино. У Videoseed нет сортировки по популярности/рейтингу,
 * поэтому показываем новинки (последние добавленные) — миксом фильмов и сериалов.
 */
export async function getPopularCinema(limit = 18): Promise<CinemaShort[]> {
  // Берём с запасом: часть элементов отсеется (нулевой/пустой id_kp).
  const each = limit;
  const [serials, movies] = await Promise.all([
    vsFetch(
      { list: 'serial', sort_by: 'post_date desc', items: String(each) },
      3600,
    ),
    vsFetch(
      { list: 'movie', sort_by: 'post_date desc', items: String(each) },
      3600,
    ),
  ]);

  // Чередуем сериалы и фильмы, чтобы на главной было и то, и другое.
  const mixed: VsRawItem[] = [];
  const max = Math.max(serials.length, movies.length);
  for (let i = 0; i < max; i++) {
    if (serials[i]) mixed.push(serials[i]);
    if (movies[i]) mixed.push(movies[i]);
  }
  return dedupe(mixed, limit);
}

/** Поиск по строке запроса среди фильмов и сериалов. */
export async function searchCinema(
  query: string,
  limit = 20,
): Promise<CinemaShort[]> {
  const q = query.trim();
  if (!q) return [];
  const [serials, movies] = await Promise.all([
    vsFetch({ list: 'serial', q, items: String(limit) }, 300),
    vsFetch({ list: 'movie', q, items: String(limit) }, 300),
  ]);

  // Сериалы первыми — раздел ими и ценен; затем фильмы.
  return dedupe([...serials, ...movies], limit);
}

/** Полная карточка тайтла по kinopoisk_id. */
export async function getCinemaById(
  kinopoiskId: number,
): Promise<CinemaFull | null> {
  // item=search подбирает единицу контента по kp вне зависимости от типа.
  const items = await vsFetch(
    { item: 'search', kp: String(kinopoiskId) },
    600,
  );
  if (items.length === 0) return null;

  const base = items[0];
  const short = toShort(base);
  if (!short) return null;

  let seasons = parseSeasons(base);
  const totalVideos = Number(base.total_videos);
  const isSerial =
    short.isSerial ||
    seasons.length > 1 ||
    (Number.isFinite(totalVideos) && totalVideos > 1);

  // Сериал без детализации сезонов (одна «плоская» дорожка) — считаем 1 сезоном.
  if (isSerial && seasons.length === 0) {
    const flat =
      Number.isFinite(totalVideos) && totalVideos > 0 ? totalVideos : 1;
    seasons = [{ season: 1, episodes: flat }];
  }

  const episodesTotal = isSerial
    ? seasons.reduce((sum, s) => sum + s.episodes, 0) || 1
    : 1;

  return {
    ...short,
    isSerial,
    description: base.description ?? null,
    episodesTotal,
    seasons,
    durationSeconds: isSerial ? null : parseDuration(base.time),
    genres: splitList(base.genre),
    countries: splitList(base.country),
  };
}

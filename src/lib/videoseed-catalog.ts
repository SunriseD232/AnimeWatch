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

import { getTmdbRatingByImdbId } from './tmdb';

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
  /** IMDb id — единственный способ найти трейлер/рейтинг в TMDB (см. lib/tmdb.ts). */
  idImdb: string | null;
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
 * `ratings` (id_imdb → vote_average) — опциональное обогащение рейтингом
 * TMDB для категорий с rankByRating, см. getCinemaByCategory.
 */
function dedupe(
  items: VsRawItem[],
  limit: number,
  ratings?: Map<string, number>,
): CinemaShort[] {
  const seen = new Set<number>();
  const out: CinemaShort[] = [];
  for (const item of items) {
    const short = toShort(item);
    if (!short || seen.has(short.id)) continue;
    if (ratings && item.id_imdb) {
      const rating = ratings.get(item.id_imdb);
      if (rating !== undefined) short.rating = rating;
    }
    seen.add(short.id);
    out.push(short);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Подтягивает рейтинг TMDB по id_imdb для набора записей (параллельно,
 * дедуп по id_imdb — франшизы/переиздания не дублируют запросы). Каждый
 * запрос кэшируется на сутки внутри getTmdbRatingByImdbId.
 */
async function enrichRatings(items: VsRawItem[]): Promise<Map<string, number>> {
  const imdbIds = [
    ...new Set(
      items.map((i) => i.id_imdb).filter((v): v is string => Boolean(v)),
    ),
  ];
  const pairs = await Promise.all(
    imdbIds.map(async (id) => [id, await getTmdbRatingByImdbId(id)] as const),
  );
  const map = new Map<string, number>();
  for (const [id, rating] of pairs) {
    if (rating !== null) map.set(id, rating);
  }
  return map;
}

/**
 * Категории раздела кино (вкладки-подсказки на главной).
 *
 * У Videoseed нет РАБОЧЕЙ серверной фильтрации по жанру/стране — параметры
 * `categories`/`category`/`genre`/`country`/`genre_id`/`country_id` либо
 * отдают 500, либо принимаются, но реально ничего не фильтруют (проверено
 * вживую: total и содержимое ответа совпадают с запросом без фильтра).
 * Поэтому фильтруем САМИ — по текстовым полям `genre`/`country`, которые
 * есть в каждой записи обычного списка (`list=movie`/`list=serial`).
 *
 * Значения genre — реальные названия из `list=category` Videoseed (id для
 * справки, используются только имена): 1 Биография, 2 Боевик, 3 Военный,
 * 4 Вестерн, 5 Документальный, 6 Детектив, 7 Детский, 8 Драма, 9 История,
 * 10 Комедия, 11 Криминал, 12 Мелодрама, 13 Приключения, 14 Семейный,
 * 15 Спорт, 16 Триллер, 17 Ужасы, 18 Фантастика, 19 Фэнтези, 21 Мультфильмы,
 * 7570 Мюзиклы, 7569 Короткометражки.
 */
export interface CinemaCategoryDef {
  /** Slug для URL (?category=, /cinema/category/[id]). */
  id: string;
  label: string;
  type: 'movie' | 'serial' | 'both';
  /** Подстрока, которую должно содержать поле genre (без учёта регистра). */
  genreMatch?: string;
  /** Подстрока, которой НЕ должно быть в genre (без учёта регистра). */
  genreExclude?: string;
  /** 'ru' — Россия/СССР в country, 'foreign' — всё остальное. */
  countryMatch?: 'ru' | 'foreign';
  /** Только вышедшие в текущем или прошлом году (по полю year). */
  recentOnly?: boolean;
  /**
   * Сортировать по рейтингу TMDB (vote_average, по id_imdb) вместо порядка
   * Videoseed. У Videoseed своего рейтинга нет и сортировка `sort_by` у него
   * не работает (тот же паттерн, что и у genre/country — см. комментарий
   * выше), поэтому и сортировка тоже целиком на нашей стороне.
   */
  rankByRating?: boolean;
}

export const CINEMA_CATEGORIES: CinemaCategoryDef[] = [
  { id: 'movies', label: 'Фильмы', type: 'movie', genreExclude: 'мультфильм' },
  {
    id: 'foreign-series',
    label: 'Зарубежные сериалы',
    type: 'serial',
    countryMatch: 'foreign',
    recentOnly: true,
    rankByRating: true,
  },
  {
    id: 'ru-series',
    label: 'Русские сериалы',
    type: 'serial',
    countryMatch: 'ru',
    recentOnly: true,
    rankByRating: true,
  },
  { id: 'cartoons', label: 'Мультфильмы', type: 'movie', genreMatch: 'мультфильм' },
  { id: 'cartoon-series', label: 'Многосерийные мультфильмы', type: 'serial', genreMatch: 'мультфильм' },
  { id: 'drama', label: 'Драма', type: 'both', genreMatch: 'драма' },
  { id: 'comedy', label: 'Комедия', type: 'both', genreMatch: 'комедия' },
  { id: 'action', label: 'Боевик', type: 'both', genreMatch: 'боевик' },
  { id: 'thriller', label: 'Триллер', type: 'both', genreMatch: 'триллер' },
  { id: 'horror', label: 'Ужасы', type: 'both', genreMatch: 'ужасы' },
  { id: 'fantasy', label: 'Фантастика', type: 'both', genreMatch: 'фантастика' },
  { id: 'melodrama', label: 'Мелодрама', type: 'both', genreMatch: 'мелодрама' },
];

function matchesCategory(item: VsRawItem, def: CinemaCategoryDef): boolean {
  const genre = (item.genre ?? '').toLowerCase();
  const country = (item.country ?? '').toLowerCase();
  if (def.genreMatch && !genre.includes(def.genreMatch)) return false;
  if (def.genreExclude && genre.includes(def.genreExclude)) return false;
  if (def.countryMatch === 'ru' && !(country.includes('росс') || country.includes('ссср'))) {
    return false;
  }
  if (def.countryMatch === 'foreign' && (country.includes('росс') || country.includes('ссср'))) {
    return false;
  }
  if (def.recentOnly) {
    const year = Number(item.year);
    const minYear = new Date().getFullYear() - 1;
    if (!Number.isFinite(year) || year < minYear) return false;
  }
  return true;
}

// Жёсткий потолок «вышестоящих» страниц Videoseed на один запрос категории —
// защита от того, что редкий жанр в глубокой странице пагинации устроит
// лавину запросов к их квотируемому API за один клик. Каждая такая страница
// кэшируется (revalidate) — стоимость платится один раз, а не на каждый визит.
const MAX_UPSTREAM_PAGES = 30;
const UPSTREAM_PAGE_SIZE = 50;

/** Копит подходящие под фильтр записи, дозапрашивая страницы, пока не хватит. */
async function collectMatching(
  type: 'movie' | 'serial',
  def: CinemaCategoryDef,
  need: number,
): Promise<{ items: VsRawItem[]; exhausted: boolean }> {
  const collected: VsRawItem[] = [];
  for (let page = 1; page <= MAX_UPSTREAM_PAGES; page++) {
    const batch = await vsFetch(
      {
        list: type,
        sort_by: 'post_date desc',
        items: String(UPSTREAM_PAGE_SIZE),
        from: String(page),
      },
      3600,
    );
    if (batch.length === 0) return { items: collected, exhausted: true };
    for (const item of batch) {
      if (matchesCategory(item, def)) collected.push(item);
    }
    if (collected.length >= need) return { items: collected, exhausted: false };
  }
  return { items: collected, exhausted: false };
}

/** Страница категории: сами карточки + есть ли ещё (для «Показать ещё»/пагинации). */
export interface CinemaCategoryPage {
  category: CinemaCategoryDef;
  items: CinemaShort[];
  hasMore: boolean;
}

// Для категорий с rankByRating собираем пул кандидатов пошире, чем нужно на
// первую страницу — иначе «сортировка по рейтингу» просто переставит те же
// 24-25 первых попавшихся записей вместо того, чтобы выбрать лучшие среди
// сколько-нибудь широкой выборки.
const RATING_CANDIDATE_POOL = 120;

/**
 * Тайтлы категории (вкладка) с постраничной навигацией. Смотри комментарий
 * у CINEMA_CATEGORIES — фильтрация целиком на нашей стороне, поверх обычных
 * list=movie/list=serial, поэтому глубокая пагинация редкой категории может
 * дозапросить несколько вышестоящих страниц (см. MAX_UPSTREAM_PAGES).
 */
export async function getCinemaByCategory(
  categoryId: string,
  page = 1,
  pageSize = 24,
): Promise<CinemaCategoryPage | null> {
  const def = CINEMA_CATEGORIES.find((c) => c.id === categoryId);
  if (!def) return null;

  const baseNeed = page * pageSize + 1; // +1 — узнать, есть ли следующая страница
  const need = def.rankByRating
    ? Math.max(baseNeed, RATING_CANDIDATE_POOL)
    : baseNeed;
  const types: ('movie' | 'serial')[] =
    def.type === 'both' ? ['movie', 'serial'] : [def.type];

  const results = await Promise.all(
    types.map((t) => collectMatching(t, def, need)),
  );

  // Для 'both' чередуем фильмы/сериалы, чтобы подборка не была однобокой.
  const merged: VsRawItem[] = [];
  const max = Math.max(...results.map((r) => r.items.length));
  for (let i = 0; i < max; i++) {
    for (const r of results) if (r.items[i]) merged.push(r.items[i]);
  }

  const ratings = def.rankByRating ? await enrichRatings(merged) : undefined;
  let deduped = dedupe(merged, merged.length, ratings);
  if (def.rankByRating) {
    // Без TMDB_API_KEY у всех rating === null — сортировка становится
    // no-op и порядок остаётся как есть, ничего не ломается.
    deduped = [...deduped].sort((a, b) => {
      const ra = a.rating ?? -1;
      const rb = b.rating ?? -1;
      if (rb !== ra) return rb - ra;
      return (b.year ?? 0) - (a.year ?? 0);
    });
  }

  const start = (page - 1) * pageSize;
  const windowed = deduped.slice(start, start + pageSize);

  return {
    category: def,
    items: windowed,
    hasMore: deduped.length > start + pageSize,
  };
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
    idImdb: base.id_imdb ?? null,
  };
}

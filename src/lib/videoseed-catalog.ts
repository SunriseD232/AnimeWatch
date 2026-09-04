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
import { getCachedJson } from './cache/apiCache';
import { signImageUrl } from './extract/proxy';
import { mapWithConcurrency } from './concurrency';
import type { OwnPlayerTranslation } from './extract/types';

const VIDEOSEED_API = 'https://api.videoseed.tv/apiv2.php';

interface VsRawSeason {
  name?: string;
  total_videos?: number | string;
  videos?: Record<string, unknown>;
}

/** Одна альтернативная озвучка тайтла — embed уже содержит default_audio_id. */
interface VsRawTranslationIframe {
  translations_id: number | string;
  name?: string;
  short_name?: string;
  iframe?: string;
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
  /** Озвучка по умолчанию (только в item=search, только у части фильмов). */
  translations_id?: number | string;
  /** Все альтернативные озвучки — только в item=search. */
  translation_iframe?: Record<string, VsRawTranslationIframe>;
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

// Апстрим Videoseed изредка зависает на list=... (проверено вживую: один
// запрос не отвечал больше 60с, при этом item=search тогда же отвечал за
// 0.2с) — без таймаута fetch() ничем не ограничен и вешает всю страницу
// (каталог/тайтл) до тех пор, пока не сработает proxy_read_timeout nginx
// (90с) или дефолтный таймаут undici. 8с достаточно с запасом (обычный
// ответ — доли секунды), а рано оборвавшийся запрос просто деградирует до
// пустого списка для этого типа/страницы (см. Promise.allSettled в
// getCinemaCatalog) вместо того, чтобы держать пользователя на скелетоне.
const VS_FETCH_TIMEOUT_MS = 8_000;

async function vsFetch(
  params: Record<string, string>,
  revalidate: number,
): Promise<VsRawItem[]> {
  const t = token();
  if (!t) return []; // без токена каталог пуст — страница покажет заглушку
  // Ключ кэша — без токена (не хотим хранить секрет в базе), но с
  // отсортированными параметрами (стабильный ключ независимо от порядка).
  const cacheKey = `videoseed:${new URLSearchParams(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
  ).toString()}`;
  return getCachedJson(cacheKey, revalidate, async () => {
    const search = new URLSearchParams({ token: t, ...params });
    const res = await fetch(`${VIDEOSEED_API}?${search.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(VS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Videoseed API error ${res.status}`);
    const data = (await res.json()) as VsResponse;
    if (data.status && data.status !== 'success') {
      throw new Error(`Videoseed API status: ${data.status}`);
    }
    return data.data ?? [];
  });
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
  const rawPoster = item.poster ?? null;
  if (!rawPoster) return null;
  // Прямые хотлинки на api.videoseed.tv не грузятся с части клиентских
  // сетей (проверено вживую 2026-08-23 — ERR_TIMED_OUT/ERR_CONNECTION_
  // CLOSED, при этом сама VPS до того же URL достаётся мгновенно) —
  // проксируем через себя, как уже сделано для видео. signImageUrl — не
  // signRawUrl: этот poster оседает в БД (watch_progress/user_list), TTL
  // сегмента (часы) тут сломал бы картинку в «Продолжить просмотр».
  const poster = signImageUrl(rawPoster);

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
 * TMDB при sort: 'rating', см. getCinemaCatalog.
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
 * Каталог кино с множественным выбором жанров (AND), исключением жанров и
 * сортировкой.
 *
 * У Videoseed нет РАБОЧЕЙ серверной фильтрации по жанру/стране — параметры
 * `categories`/`category`/`genre`/`country`/`genre_id`/`country_id` либо
 * отдают 500, либо принимаются, но реально ничего не фильтруют (проверено
 * вживую: total и содержимое ответа совпадают с запросом без фильтра). И
 * `sort_by` тоже не работает надёжно. Поэтому фильтрация и сортировка —
 * ЦЕЛИКОМ на нашей стороне, по текстовому полю `genre`, которое есть в
 * каждой записи обычного списка (`list=movie`/`list=serial`) — в отличие от
 * Shikimori это не требует догрузки полной карточки на кандидата, жанр уже
 * под рукой в списке.
 *
 * Названия жанров — реальные значения из `list=category` Videoseed:
 * Биография, Боевик, Военный, Вестерн, Документальный, Детектив, Детский,
 * Драма, История, Комедия, Криминал, Мелодрама, Приключения, Семейный,
 * Спорт, Триллер, Ужасы, Фантастика, Фэнтези, Мультфильмы, Мюзиклы,
 * Короткометражки.
 */
export const CINEMA_GENRES: string[] = [
  'Биография',
  'Боевик',
  'Военный',
  'Вестерн',
  'Документальный',
  'Детектив',
  'Детский',
  'Драма',
  'История',
  'Комедия',
  'Криминал',
  'Мелодрама',
  'Мультфильмы',
  'Мюзиклы',
  'Приключения',
  'Семейный',
  'Спорт',
  'Триллер',
  'Ужасы',
  'Фантастика',
  'Фэнтези',
  'Короткометражки',
];

export const CINEMA_CATALOG_SORTS = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'rating', label: 'По рейтингу' },
] as const;
export type CinemaCatalogSort = (typeof CINEMA_CATALOG_SORTS)[number]['value'];

export interface CinemaCatalogParams {
  type: 'movie' | 'serial' | 'both';
  /** Жанр должен встретиться у тайтла — ВСЕ перечисленные (AND). */
  genresInclude: string[];
  /** Ни один из этих жанров не должен встретиться у тайтла. */
  genresExclude: string[];
  sort: CinemaCatalogSort;
  page: number;
  pageSize: number;
}

export interface CinemaCatalogPage {
  items: CinemaShort[];
  hasMore: boolean;
}

function matchesFilter(
  item: VsRawItem,
  genresInclude: string[],
  genresExclude: string[],
): boolean {
  const genre = (item.genre ?? '').toLowerCase();
  const hasAllIncluded = genresInclude.every((g) => genre.includes(g.toLowerCase()));
  const hasExcluded = genresExclude.some((g) => genre.includes(g.toLowerCase()));
  return hasAllIncluded && !hasExcluded;
}

// Жёсткий потолок «вышестоящих» страниц Videoseed на один запрос —
// защита от того, что редкая комбинация жанров устроит лавину запросов к их
// квотируемому API за один клик. Каждая такая страница кэшируется
// (revalidate) — стоимость платится один раз, а не на каждый визит.
const MAX_UPSTREAM_PAGES = 30;
const UPSTREAM_PAGE_SIZE = 50;
// Страницы внутри пачки запрашиваются параллельно (Promise.all), пачки —
// последовательно. Раньше все до 30 страниц шли строго одна за другой
// (await в цикле) — для редкого/generic-жанра (например, буквального тега
// «Сериалы», который почти не встречается ПОДСТРОКОЙ в genre других
// тайтлов) это означало перебор всех 30 страниц ПОДРЯД перед тем, как
// сдаться, даже если каждая из них уже в кэше (кэш всё равно отдельный
// round-trip на страницу) — на практике страница тайтла с таким жанром
// грузилась 6+ секунд из-за одного этого. Пачками по 5 — тот же итоговый
// объём запросов к апстриму, но без ожидания их по одному.
const PAGE_BATCH_SIZE = 5;

/** Копит подходящие под фильтр записи, дозапрашивая страницы, пока не хватит. */
async function collectFiltered(
  type: 'movie' | 'serial',
  genresInclude: string[],
  genresExclude: string[],
  need: number,
): Promise<VsRawItem[]> {
  const collected: VsRawItem[] = [];
  for (
    let batchStart = 1;
    batchStart <= MAX_UPSTREAM_PAGES;
    batchStart += PAGE_BATCH_SIZE
  ) {
    const pageCount = Math.min(PAGE_BATCH_SIZE, MAX_UPSTREAM_PAGES - batchStart + 1);
    const pages = Array.from({ length: pageCount }, (_, i) => batchStart + i);
    const batches = await Promise.all(
      pages.map((page) =>
        vsFetch(
          {
            list: type,
            sort_by: 'post_date desc',
            items: String(UPSTREAM_PAGE_SIZE),
            from: String(page),
          },
          3600,
        ),
      ),
    );

    let reachedEnd = false;
    for (const batch of batches) {
      if (batch.length === 0) {
        reachedEnd = true;
        break;
      }
      for (const item of batch) {
        if (matchesFilter(item, genresInclude, genresExclude)) collected.push(item);
      }
      if (batch.length < UPSTREAM_PAGE_SIZE) reachedEnd = true;
    }
    if (collected.length >= need || reachedEnd) break;
  }
  return collected;
}

// Любая наша сортировка (по году или по TMDB-рейтингу) — переупорядочивание
// уже собранного пула на своей стороне, поэтому пул всегда собираем шире,
// чем нужно на текущую страницу — иначе сортировка просто переставит первые
// попавшиеся 24-25 записей вместо выбора лучших/новых среди широкой выборки.
const SORT_CANDIDATE_POOL = 120;

/**
 * Единая функция каталога — используется и «Каталогом» (с фильтрами), и
 * «Новинками» (sort: 'new', без фильтров), и «Популярным» (sort: 'rating',
 * без фильтров) — см. getNewCinema/getPopularCinemaRanked ниже.
 */
export async function getCinemaCatalog(
  params: CinemaCatalogParams,
): Promise<CinemaCatalogPage> {
  const { type, genresInclude, genresExclude, sort, page, pageSize } = params;
  const baseNeed = page * pageSize + 1;
  const need = Math.max(baseNeed, SORT_CANDIDATE_POOL);
  const types: ('movie' | 'serial')[] = type === 'both' ? ['movie', 'serial'] : [type];

  // allSettled — та же причина, что и в searchCinema: один тип не должен
  // ронять всю подборку, если Videoseed квакнет status:"error" именно на нём.
  const settled = await Promise.allSettled(
    types.map((t) => collectFiltered(t, genresInclude, genresExclude, need)),
  );
  const results = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));

  // Для 'both' чередуем фильмы/сериалы, чтобы подборка не была однобокой.
  const merged: VsRawItem[] = [];
  const max = Math.max(...results.map((r) => r.length));
  for (let i = 0; i < max; i++) {
    for (const r of results) if (r[i]) merged.push(r[i]);
  }

  const ratings = sort === 'rating' ? await enrichRatings(merged) : undefined;
  let deduped = dedupe(merged, merged.length, ratings);

  if (sort === 'rating') {
    // Без TMDB_API_KEY у всех rating === null — сортировка no-op, порядок
    // остаётся как есть, ничего не ломается.
    deduped = [...deduped].sort((a, b) => {
      const ra = a.rating ?? -1;
      const rb = b.rating ?? -1;
      if (rb !== ra) return rb - ra;
      return (b.year ?? 0) - (a.year ?? 0);
    });
  } else {
    // 'new' — у Videoseed нет точной даты выхода, только год.
    deduped = [...deduped].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  }

  const start = (page - 1) * pageSize;
  const windowed = deduped.slice(start, start + pageSize);
  return { items: windowed, hasMore: deduped.length > start + pageSize };
}

/** «Новинки» — весь каталог (фильмы+сериалы), от новых к старым по году. */
export async function getNewCinema(
  page = 1,
  pageSize = 24,
): Promise<CinemaCatalogPage> {
  return getCinemaCatalog({
    type: 'both',
    genresInclude: [],
    genresExclude: [],
    sort: 'new',
    page,
    pageSize,
  });
}

/**
 * «Популярное» — весь каталог, отсортированный по рейтингу TMDB (у
 * Videoseed своего рейтинга нет вообще). Требует TMDB_API_KEY — без него
 * сортировка no-op и список просто в порядке апстрима.
 */
export async function getPopularCinemaRanked(
  page = 1,
  pageSize = 24,
): Promise<CinemaCatalogPage> {
  return getCinemaCatalog({
    type: 'both',
    genresInclude: [],
    genresExclude: [],
    sort: 'rating',
    page,
    pageSize,
  });
}

/** Поиск по строке запроса среди фильмов и сериалов. */
export async function searchCinema(
  query: string,
  limit = 20,
): Promise<CinemaShort[]> {
  const q = query.trim();
  if (!q) return [];
  // allSettled, не all: Videoseed на некоторые текстовые запросы отдаёт
  // status:"error" ПРИ ЭТОМ с непустым data (проверено вживую на запросе,
  // который реально матчит только сериалы, — list=movie падает с error, а
  // list=serial тем же самым запросом отвечает success) — vsFetch кидает на
  // любой status!=='success' (правильно само по себе), но раньше это через
  // Promise.all роняло ВЕСЬ поиск, даже если вторая половина (serial) нашла
  // результат. Один упавший список не должен топить оба.
  const [serials, movies] = await Promise.allSettled([
    vsFetch({ list: 'serial', q, items: String(limit) }, 300),
    vsFetch({ list: 'movie', q, items: String(limit) }, 300),
  ]);

  // Сериалы первыми — раздел ими и ценен; затем фильмы.
  return dedupe(
    [
      ...(serials.status === 'fulfilled' ? serials.value : []),
      ...(movies.status === 'fulfilled' ? movies.value : []),
    ],
    limit,
  );
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

/**
 * Общее число серий для НЕБОЛЬШОГО набора id — CinemaShort (карточки в
 * каталоге) этого поля не содержит вовсе (только CinemaFull, детальная
 * карточка тайтла), а тянуть его для всех 24 карточек страницы ради бейджа
 * прогресса было бы 24 лишних запроса к Videoseed на каждый рендер каталога.
 * Вызывающая сторона (страницы каталога/карусели) сама сужает список ДО
 * вызова этой функции — только id, у которых есть watch_progress (обычно
 * единицы), см. getEpisodeProgressMap. getCinemaById кэширован (600с), так
 * что повторный вызов для того же id в других разделах сайта не бьёт по
 * квоте заново.
 */
export async function getCinemaEpisodesTotalMap(
  kinopoiskIds: number[],
): Promise<Map<number, number>> {
  if (kinopoiskIds.length === 0) return new Map();
  const results = await mapWithConcurrency(kinopoiskIds, 4, (id) =>
    getCinemaById(id).catch(() => null),
  );
  const map = new Map<number, number>();
  results.forEach((full, i) => {
    if (full) map.set(kinopoiskIds[i], full.episodesTotal);
  });
  return map;
}

/**
 * Число сезонов для НЕБОЛЬШОГО набора id — нужно карусели «Продолжить
 * просмотр» (см. ContinueCard), чтобы решить, писать ли сезон в подписи:
 * «Сезон 2, серия 5» для многосезонных тайтлов, просто «Серия 5» — для
 * односезонных (сезон и так всегда 1, писать нечего). Тот же приём, что и
 * getCinemaEpisodesTotalMap чуть выше (кэшированный getCinemaById,
 * ограниченная параллельность) — отдельная функция, а не переиспользование
 * той же карты: у неё другой смысл поля (эпизоды, не сезоны) и другой набор
 * вызывающих (везде, где есть watch_progress, а не только на карусели).
 */
export async function getCinemaSeasonCountMap(
  kinopoiskIds: number[],
): Promise<Map<number, number>> {
  if (kinopoiskIds.length === 0) return new Map();
  const results = await mapWithConcurrency(kinopoiskIds, 4, (id) =>
    getCinemaById(id).catch(() => null),
  );
  const map = new Map<number, number>();
  results.forEach((full, i) => {
    if (full) map.set(kinopoiskIds[i], full.seasons.length);
  });
  return map;
}

/**
 * Все альтернативные озвучки тайтла из Videoseed (item=search отдаёт
 * translation_iframe — на каждую озвучку готовый embed с default_audio_id,
 * найдено при разборе сырого ответа каталога, в отличие от embed-страницы
 * плеера, где эти данные не видны). embed уже указывает на нужный
 * внутренний id (для фильма — embed/{id}, для сериала — embed_serial/{id}),
 * добавляем только video=sСЕЗОНvСЕРИЯ для сериала — подтверждено вживую
 * (см. коммит), что параметр работает и на embed_serial.
 *
 * Пустой список — нет данных по озвучкам (старые/непроиндексированные
 * тайтлы) или отсутствует токен; вызывающий код в этом случае должен сам
 * выставить единственный синтетический трек (старое поведение).
 *
 * isSerial НЕ передаётся отдельным параметром — сериал определяем по самому
 * пути embed (embed_serial/{id}/ у сериала, embed/{id}/ у фильма), это же
 * значение приходит и из resolve.ts, где нет доступа к CinemaFull.isSerial.
 */
// vps-extractor быстрым HTTP-путём (без Puppeteer) отдаёт РЕАЛЬНО доступные
// озвучки конкретной серии — см. listAvailableTranslations в
// vps-extractor/src/videoseed-http.js. Кэшируем ответ отдельно от самого
// каталога (getCachedJson, тот же механизм, что и vsFetch выше) — 30 минут:
// доступность дорожек меняется редко, а запрос идёт к тому же квотируемому
// апстриму Videoseed, что и сам каталог.
const REAL_TRANSLATIONS_CACHE_TTL_S = 1800;
const REAL_TRANSLATIONS_TIMEOUT_MS = 8_000;

/**
 * Множество реально доступных названий озвучек для (kp, season, episode),
 * нормализованных (trim+lowercase) под сравнение с short_name/name каталога.
 * null — не удалось узнать (extractor недоступен, таймаут, серия не нашлась
 * в его конфиге) — вызывающий код НЕ должен фильтровать этим null (fail-open:
 * лучше показать лишнюю озвучку, чем ошибочно спрятать все).
 */
async function getRealTranslationLabels(
  kinopoiskId: number,
  season: number,
  episode: number,
): Promise<Set<string> | null> {
  const baseUrl = process.env.VPS_EXTRACTOR_URL;
  const token = process.env.VPS_EXTRACTOR_TOKEN;
  if (!baseUrl || !token) return null;
  try {
    const labels = await getCachedJson<string[] | null>(
      `videoseed-real-translations:${kinopoiskId}:${season}:${episode}`,
      REAL_TRANSLATIONS_CACHE_TTL_S,
      async () => {
        const res = await fetch(new URL('/videoseed-translations', baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shikimoriId: kinopoiskId, season, episode }),
          signal: AbortSignal.timeout(REAL_TRANSLATIONS_TIMEOUT_MS),
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`vps-extractor /videoseed-translations ${res.status}`);
        const data = (await res.json()) as { labels?: string[] };
        return Array.isArray(data.labels) ? data.labels : null;
      },
    );
    return labels ? new Set(labels.map((l) => l.trim().toLowerCase())) : null;
  } catch (err) {
    // Сетевая ошибка/таймаут — не кэшируется (см. getCachedJson: ошибки
    // fetcher'а не пишутся в базу), просто не фильтруем в этот раз.
    console.error(
      `[videoseed] getRealTranslationLabels kp=${kinopoiskId} s${season}e${episode} упал (фильтрация озвучек пропущена):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Все альтернативные озвучки тайтла ИЗ ТЕХ, ЧТО РЕАЛЬНО ДОСТУПНЫ для этой
 * серии (см. getRealTranslationLabels) — иначе пользователь мог выбрать
 * озвучку, которую каталог Videoseed заявляет, но не закодировал для этой
 * серии: HTTP-путь извлечения такую честно не находит (~1-2с), после чего
 * идёт откат на Puppeteer (~9с) ради ТАКОГО ЖЕ честного отказа — пользователь
 * просто зря ждал лишние секунды ради кнопки, которая заведомо не сработает.
 * Проверено вживую 2026-09-02: на части тайтлов ("Мятеж" kp=1240162) 6 из 10
 * заявленных в каталоге озвучек отсутствовали во всех проверенных сериях —
 * это разные списки по смыслу (translation_iframe — кто озвучивал тайтл
 * ХОТЬ КОГДА-ТО, а не что закодировано именно для этой серии сейчас), а не
 * баг конкретной ссылки.
 */
export async function getVideoseedOwnPlayerTranslations(
  kinopoiskId: number,
  season: number,
  episode: number,
): Promise<OwnPlayerTranslation[]> {
  // vsFetch бросает на не-2xx, на status!=='success' и на собственном
  // таймауте (см. её же комментарий про зависания Videoseed) — в отличие от
  // соседей (getKodikOwnPlayerTranslations, getAllohaSources), этот вызов
  // раньше ничем не был обёрнут и падал сквозь Promise.all в
  // resolveCinemaEpisodeSources, роняя всю страницу серии транзиентной
  // ошибкой одного источника вместо деградации до пустого списка.
  let items: Awaited<ReturnType<typeof vsFetch>>;
  try {
    items = await vsFetch({ item: 'search', kp: String(kinopoiskId) }, 600);
  } catch (err) {
    console.error(
      `[videoseed] getVideoseedOwnPlayerTranslations kp=${kinopoiskId} упал:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
  const base = items[0];
  if (!base?.translation_iframe) return [];

  const defaultId = Number(base.translations_id);
  const seen = new Set<number>();
  const built: { id: number; rawLabel: string; embedUrl: string }[] = [];
  for (const t of Object.values(base.translation_iframe)) {
    const id = Number(t.translations_id);
    if (!Number.isFinite(id) || !t.iframe || seen.has(id)) continue;
    seen.add(id);

    let embedUrl = t.iframe;
    if (embedUrl.includes('/embed_serial/') && episode > 0) {
      const s = season > 0 ? season : 1;
      embedUrl += `${embedUrl.includes('?') ? '&' : '?'}video=s${s}v${episode}`;
    }

    built.push({ id, rawLabel: t.short_name || t.name || 'Озвучка', embedUrl });
  }

  const realLabels = await getRealTranslationLabels(kinopoiskId, season, episode);
  const filtered = realLabels ? built.filter((t) => realLabels.has(t.rawLabel.trim().toLowerCase())) : built;
  // Пустое пересечение при непустом каталожном списке говорит скорее о
  // рассинхроне форматов имён (сайт Videoseed поменял разметку и т.п.), чем
  // о том, что ВСЕ озвучки разом пропали — безопаснее откатиться к
  // нефильтрованному списку, чем спрятать все вкладки сразу.
  const finalList = filtered.length > 0 ? filtered : built;

  const out: OwnPlayerTranslation[] = finalList.map((t) => ({
    id: t.id,
    title: `${t.rawLabel} · Videoseed`,
    embedUrl: t.embedUrl,
    source: 'videoseed',
  }));

  // Озвучка по умолчанию (та же, что раньше открывалась без явного выбора) —
  // первой в списке, она же станет выбором по умолчанию в OwnPlayer.
  out.sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0));
  return out;
}

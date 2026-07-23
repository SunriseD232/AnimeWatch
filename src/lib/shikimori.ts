/**
 * Клиент Shikimori API.
 * Все запросы выполняются на сервере (Server Components / Route Handlers)
 * с обязательным User-Agent и щадящим rate limit (5 rps / 90 rpm).
 */

import { getYummyPostersMap } from './video/yummy';
import { mapWithConcurrency } from './concurrency';

// ВАЖНО: Shikimori переехал с shikimori.one на shikimori.io. Старый домен
// отвечает редиректами, из-за чего картинки показывали плейсхолдер.
const BASE_URL = 'https://shikimori.io';
const API_URL = `${BASE_URL}/api`;
const USER_AGENT = 'MediaWatch MVP';

/** Краткая карточка аниме (списки, поиск, популярное). */
export interface ShikimoriAnimeShort {
  id: number;
  name: string;
  russian: string;
  image: {
    original: string;
    preview: string;
    x96: string;
    x48: string;
  };
  url: string;
  kind: string | null;
  score: string;
  status: string;
  episodes: number;
  episodes_aired: number;
  aired_on: string | null;
  released_on: string | null;
}

interface ShikimoriVideo {
  url: string;
  player_url: string;
  kind: string;
  hosting: string;
}

/** Полная карточка аниме (страница тайтла). */
export interface ShikimoriAnimeFull extends ShikimoriAnimeShort {
  rating: string;
  duration: number;
  description: string | null;
  description_html: string | null;
  genres: { id: number; name: string; russian: string }[];
  videos: ShikimoriVideo[];
}

/**
 * Embed-URL трейлера (kind === 'pv' — promotional video) с YouTube, если есть.
 * Shikimori отдаёt его в полной карточке — доп. запрос не нужен.
 */
export function trailerEmbedUrl(anime: ShikimoriAnimeFull): string | null {
  const trailer = anime.videos?.find(
    (v) => v.kind === 'pv' && v.hosting === 'youtube',
  );
  return trailer ? trailer.player_url.replace('http://', 'https://') : null;
}

// --- Простой троттлер: не более N запросов в скользящем окне 1 сек ---
// Shikimori заявляет 5 rps / 90 rpm. Мгновенный лимит здесь — 5 rps, но
// каталог с AND/exclude по жанрам (см. getAnimeCatalog) намеренно держит
// свой собственный, более консервативный потолок кандидатов — иначе один
// проход по редкой комбинации жанров сам съел бы весь бюджет 90 rpm.
const MAX_RPS = 5;
let windowStart = Date.now();
let countInWindow = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  if (now - windowStart >= 1000) {
    windowStart = now;
    countInWindow = 0;
  }
  if (countInWindow >= MAX_RPS) {
    const wait = 1000 - (now - windowStart) + 5;
    await new Promise((r) => setTimeout(r, wait));
    windowStart = Date.now();
    countInWindow = 0;
  }
  countInWindow += 1;
}

async function shikimoriFetch<T>(
  path: string,
  revalidate: number,
): Promise<T> {
  await throttle();
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    next: { revalidate },
  });

  if (!res.ok) {
    throw new Error(
      `Shikimori API error ${res.status} на ${path}`,
    );
  }
  return (await res.json()) as T;
}

/** Абсолютный URL картинки из относительного пути Shikimori. */
export function imageUrl(path: string | undefined | null): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${BASE_URL}${path}`;
}

/**
 * Подменяет постеры на Yummy (api.yani.tv) там, где для тайтла есть точное
 * совпадение по shikimori_id — у Shikimori часто отдаёт плейсхолдер вместо
 * реального постера, у Yummy покрытие лучше. Один батч-запрос на весь список.
 * Тайтлы без совпадения остаются с оригинальным постером Shikimori.
 */
async function withYummyPosters<T extends ShikimoriAnimeShort>(
  items: T[],
): Promise<T[]> {
  if (items.length === 0) return items;
  const posters = await getYummyPostersMap(items.map((i) => i.id));
  if (posters.size === 0) return items;
  return items.map((item) => {
    const override = posters.get(item.id);
    if (!override) return item;
    return { ...item, image: { ...item.image, original: override } };
  });
}

/** Одна страница «Популярного»: сами тайтлы + есть ли следующая страница. */
export interface PopularPage {
  items: ShikimoriAnimeShort[];
  hasMore: boolean;
}

/**
 * Популярное — топ по рейтингу среди тайтлов текущего аниме-года
 * (`order=ranked`, а не `order=popularity`, который у Shikimori вообще не
 * про рейтинг, а про метрику охвата). Полная пагинация — используется и на
 * превью-ряде главной, и на отдельной странице /popular.
 *
 * Лимит на страницу ограничен самим Shikimori 50 записями — если запросят
 * больше, API молча обрежет.
 */
export async function getPopularRanked(
  page = 1,
  limit = 24,
): Promise<PopularPage> {
  const year = new Date().getFullYear();
  const params = new URLSearchParams({
    order: 'ranked',
    season: String(year),
    kind: 'tv,movie,ona',
    limit: String(limit),
    page: String(page),
  });
  const items = await shikimoriFetch<ShikimoriAnimeShort[]>(
    `/animes?${params.toString()}`,
    1800,
  );
  return {
    items: await withYummyPosters(items),
    // Shikimori не отдаёт общее число страниц — эвристика: неполная
    // страница означает, что дальше пусто.
    hasMore: items.length === limit,
  };
}


/** Жанр аниме — id + русское/английское имя (для каталога). */
export interface AnimeGenre {
  id: number;
  name: string;
  russian: string;
}

interface ShikimoriGenreEntry extends AnimeGenre {
  kind: string;
  entry_type: string;
}

let cachedGenres: AnimeGenre[] | null = null;

/**
 * Полный список жанров аниме — для каталога (множественный выбор +
 * исключение). `/genres` отдаёт жанры аниме И манги вперемешку под общими
 * id-пространством — фильтруем по entry_type. Список почти не меняется,
 * кэшируем и в Next.js (revalidate раз в сутки), и в памяти процесса —
 * не нужно гонять его заново на каждый рендер страницы каталога.
 */
export async function getAnimeGenres(): Promise<AnimeGenre[]> {
  if (cachedGenres) return cachedGenres;
  const all = await shikimoriFetch<ShikimoriGenreEntry[]>('/genres', 86400);
  const genres = all
    .filter((g) => g.entry_type === 'Anime' && g.kind === 'genre')
    .map((g) => ({ id: g.id, name: g.name, russian: g.russian }))
    .sort((a, b) => a.russian.localeCompare(b.russian, 'ru'));
  cachedGenres = genres;
  return genres;
}

/** Варианты сортировки каталога — значения совпадают с `order` у Shikimori. */
export const ANIME_CATALOG_SORTS = [
  { value: 'aired_on', label: 'Сначала новые' },
  { value: 'ranked', label: 'По рейтингу' },
  { value: 'popularity', label: 'По популярности' },
  { value: 'name', label: 'По алфавиту' },
] as const;
export type AnimeCatalogSort = (typeof ANIME_CATALOG_SORTS)[number]['value'];

export interface AnimeCatalogParams {
  genresInclude: number[];
  genresExclude: number[];
  sort: AnimeCatalogSort;
  page: number;
  pageSize: number;
}

export interface AnimeCatalogPage {
  items: ShikimoriAnimeShort[];
  hasMore: boolean;
}

// Потолок карточек, которые каталог готов догрузить целиком (для AND/exclude
// — см. ниже) за один запрос страницы. Ограничивает не только время ответа
// (у serverless есть свой таймаут), но и бюджет 90 rpm — при 5 rps 120
// карточек это ~24 сек и большая часть минутного лимита Shikimori разом,
// закладываем разумный запас на случай, что кто-то ещё дёргает API в это же
// время (поиск, страницы тайтлов других пользователей).
const MAX_CATALOG_CANDIDATES = 120;
const CATALOG_CONCURRENCY = 5;
const UPSTREAM_PAGE_SIZE = 50;

/**
 * Каталог аниме с множественным выбором жанров (AND — тайтл должен иметь
 * ВСЕ выбранные) и исключением (тайтл не должен иметь НИ ОДНОГО из
 * исключённых). У Shikimori в списковых ответах жанров нет вообще (только
 * в полной карточке `/animes/{id}`), а параметр `genre=` — это OR, не AND, и
 * без исключения совсем. Поэтому:
 *
 * - Без exclude и максимум с одним include-жанром — «быстрый путь»: обычная
 *   пагинация `/animes?genre=X&order=...&page=N`, без догрузки карточек.
 * - Иначе — «медленный путь»: используем include-жанры как OR-предфильтр
 *   (сужает пространство поиска, хоть и не даёт точный AND), затем
 *   параллельно (см. mapWithConcurrency) догружаем полную карточку каждого
 *   кандидата и проверяем AND/exclude по её реальному списку жанров.
 *   Кэш `getAnime()` (час) делает повторные заходы по той же комбинации
 *   почти бесплатными — цена платится один раз «в фоне».
 */
export async function getAnimeCatalog(
  params: AnimeCatalogParams,
): Promise<AnimeCatalogPage> {
  const { genresInclude, genresExclude, sort, page, pageSize } = params;
  const needsFullFilter = genresExclude.length > 0 || genresInclude.length > 1;

  if (!needsFullFilter) {
    const qp = new URLSearchParams({
      order: sort,
      kind: 'tv,movie,ona',
      limit: String(pageSize),
      page: String(page),
    });
    if (genresInclude.length === 1) qp.set('genre', String(genresInclude[0]));
    const items = await shikimoriFetch<ShikimoriAnimeShort[]>(
      `/animes?${qp.toString()}`,
      1800,
    );
    return {
      items: await withYummyPosters(items),
      hasMore: items.length === pageSize,
    };
  }

  const need = page * pageSize + 1;
  const matches: ShikimoriAnimeShort[] = [];
  let examined = 0;
  let upstreamPage = 1;

  while (matches.length < need && examined < MAX_CATALOG_CANDIDATES) {
    const qp = new URLSearchParams({
      order: sort,
      kind: 'tv,movie,ona',
      limit: String(UPSTREAM_PAGE_SIZE),
      page: String(upstreamPage),
    });
    if (genresInclude.length > 0) qp.set('genre', genresInclude.join(','));

    const batch = await shikimoriFetch<ShikimoriAnimeShort[]>(
      `/animes?${qp.toString()}`,
      3600,
    );
    if (batch.length === 0) break;

    const remainingBudget = MAX_CATALOG_CANDIDATES - examined;
    const toExamine = batch.slice(0, remainingBudget);
    examined += toExamine.length;

    const fulls = await mapWithConcurrency(
      toExamine,
      CATALOG_CONCURRENCY,
      (item) => getAnime(item.id).catch(() => null),
    );

    for (const full of fulls) {
      if (!full) continue;
      const ids = full.genres.map((g) => g.id);
      const hasAllIncluded = genresInclude.every((id) => ids.includes(id));
      const hasNoExcluded = !genresExclude.some((id) => ids.includes(id));
      if (hasAllIncluded && hasNoExcluded) matches.push(full);
      if (matches.length >= need) break;
    }

    if (batch.length < UPSTREAM_PAGE_SIZE) break; // апстрим исчерпан
    upstreamPage++;
  }

  const start = (page - 1) * pageSize;
  const windowed = await withYummyPosters(matches.slice(start, start + pageSize));
  return {
    items: windowed,
    hasMore: matches.length > start + pageSize,
  };
}

/**
 * Новинки — последние вышедшие тайтлы, от новых к старым (`order=aired_on`,
 * проверено вживую: сортирует по убыванию даты «из коробки», доп. `_desc`
 * варианта в API нет и не нужен).
 */
export async function getNewAnime(
  page = 1,
  pageSize = 24,
): Promise<AnimeCatalogPage> {
  return getAnimeCatalog({
    genresInclude: [],
    genresExclude: [],
    sort: 'aired_on',
    page,
    pageSize,
  });
}

/** Разбивает название на слова (латиница/кириллица/цифры). */
function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/)
    .filter(Boolean);
}

/** Вес типа тайтла для ранжирования поиска: сериалы и фильмы важнее спешлов. */
const KIND_WEIGHT: Record<string, number> = {
  tv: 3,
  movie: 2,
  ona: 1,
  ova: 1,
  special: 0,
  tv_special: 0,
  music: -1,
};

/**
 * Поиск по строке запроса с точным пословным совпадением.
 *
 * Shikimori ищет нечётко и возвращает ложные результаты («Sword Art Offline»
 * по запросу «art online»), а параметр order при поиске игнорирует. Поэтому:
 * 1) фильтруем сами — каждое слово запроса должно совпадать с началом
 *    какого-то слова в одном из названий (ru/en) тайтла:
 *    «art online» → Sword Art Online (без Offline); «art» → всё со словом art;
 * 2) анонсы отсекаем (смотреть там нечего);
 * 3) ранжируем локально: сериалы/фильмы выше спешлов, внутри — по рейтингу.
 */
export async function searchAnime(
  query: string,
  limit = 20,
): Promise<ShikimoriAnimeShort[]> {
  const q = query.trim();
  if (!q) return [];
  // Берём с запасом: часть выдачи отсеется пословным фильтром.
  const raw = await shikimoriFetch<ShikimoriAnimeShort[]>(
    `/animes?search=${encodeURIComponent(q)}&limit=45`,
    300,
  );

  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const matches = raw.filter((anime) => {
    if (anime.status === 'anons') return false;
    const titles = [anime.russian, anime.name].filter(Boolean) as string[];
    return titles.some((title) => {
      const tw = titleWords(title);
      return words.every((w) => tw.some((word) => word.startsWith(w)));
    });
  });

  matches.sort((a, b) => {
    const kindDiff =
      (KIND_WEIGHT[b.kind ?? ''] ?? 0) - (KIND_WEIGHT[a.kind ?? ''] ?? 0);
    if (kindDiff !== 0) return kindDiff;
    return Number(b.score) - Number(a.score);
  });

  return withYummyPosters(matches.slice(0, limit));
}

/**
 * Полная карточка тайтла по id. Подмена постера на Yummy применяется и
 * здесь — от неё зависит и страница тайтла, и постер, сохраняемый в
 * прогресс просмотра (watch-страница берёт его из этой же функции).
 */
export async function getAnime(
  id: number,
): Promise<ShikimoriAnimeFull> {
  const anime = await shikimoriFetch<ShikimoriAnimeFull>(
    `/animes/${id}`,
    3600,
  );
  const [withPoster] = await withYummyPosters([anime]);
  return withPoster;
}

interface ShikimoriRelatedEntry {
  relation: string;
  anime: ShikimoriAnimeShort | null;
}

/**
 * Прямые продолжения тайтла (сиквелы франшизы, не приквелы/спин-оффы).
 * Обычно один элемент, но у некоторых франшиз ветвится на несколько.
 * Резилентно: любая ошибка API → пустой список, страница не падает.
 */
export async function getSequels(id: number): Promise<ShikimoriAnimeShort[]> {
  try {
    const related = await shikimoriFetch<ShikimoriRelatedEntry[]>(
      `/animes/${id}/related`,
      3600,
    );
    const sequels = related
      .filter((r) => r.relation === 'Sequel' && r.anime !== null)
      .map((r) => r.anime as ShikimoriAnimeShort);
    return withYummyPosters(sequels);
  } catch {
    return [];
  }
}

/**
 * Прямые предыдущие сезоны тайтла (приквелы франшизы) — зеркало getSequels,
 * тот же эндпоинт /related, фильтр по relation==='Prequel'. Резилентно так же.
 */
export async function getPrequels(id: number): Promise<ShikimoriAnimeShort[]> {
  try {
    const related = await shikimoriFetch<ShikimoriRelatedEntry[]>(
      `/animes/${id}/related`,
      3600,
    );
    const prequels = related
      .filter((r) => r.relation === 'Prequel' && r.anime !== null)
      .map((r) => r.anime as ShikimoriAnimeShort);
    return withYummyPosters(prequels);
  } catch {
    return [];
  }
}

/** Похожие тайтлы (рекомендации Shikimori), для карточки/страницы просмотра. */
export async function getSimilarAnime(
  id: number,
  limit = 12,
): Promise<ShikimoriAnimeShort[]> {
  try {
    const similar = await shikimoriFetch<ShikimoriAnimeShort[]>(
      `/animes/${id}/similar`,
      3600,
    );
    return withYummyPosters(similar.slice(0, limit));
  } catch {
    return [];
  }
}

/**
 * Очищает BB-код Shikimori из описания, оставляя plain text.
 */
export function stripBbCode(text: string | null | undefined): string {
  if (!text) return '';
  return text
    // [character=id]Name[/character] и подобные парные теги с атрибутом
    .replace(/\[(\w+)=[^\]]*\]([\s\S]*?)\[\/\1\]/g, '$2')
    // одиночные теги вида [something]
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Число серий: для онгоингов берём aired, иначе объявленное. */
export function episodeCount(anime: {
  episodes: number;
  episodes_aired: number;
  status: string;
}): number {
  if (anime.status === 'ongoing' && anime.episodes_aired > 0) {
    return anime.episodes_aired;
  }
  if (anime.episodes > 0) return anime.episodes;
  return anime.episodes_aired > 0 ? anime.episodes_aired : 1;
}

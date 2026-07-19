/**
 * Клиент Shikimori API.
 * Все запросы выполняются на сервере (Server Components / Route Handlers)
 * с обязательным User-Agent и щадящим rate limit (5 rps / 90 rpm).
 */

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

/** Полная карточка аниме (страница тайтла). */
export interface ShikimoriAnimeFull extends ShikimoriAnimeShort {
  rating: string;
  duration: number;
  description: string | null;
  description_html: string | null;
  genres: { id: number; name: string; russian: string }[];
}

// --- Простой троттлер: не более N запросов в скользящем окне 1 сек ---
const MAX_RPS = 4;
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

/** Популярные онгоинги для главной. */
export async function getPopular(
  limit = 18,
): Promise<ShikimoriAnimeShort[]> {
  return shikimoriFetch<ShikimoriAnimeShort[]>(
    `/animes?order=popularity&limit=${limit}&status=ongoing`,
    3600,
  );
}

/** Жанры для чипов фильтра на главной (id — как в API Shikimori). */
export const GENRE_CHIPS: { id: number; label: string }[] = [
  { id: 1, label: 'Экшен' },
  { id: 2, label: 'Приключения' },
  { id: 4, label: 'Комедия' },
  { id: 8, label: 'Драма' },
  { id: 10, label: 'Фэнтези' },
  { id: 22, label: 'Романтика' },
  { id: 24, label: 'Фантастика' },
  { id: 37, label: 'Сверхъестественное' },
  { id: 41, label: 'Триллер' },
  { id: 36, label: 'Повседневность' },
  { id: 23, label: 'Школа' },
  { id: 30, label: 'Спорт' },
];

/**
 * Самые рейтинговые из недавно вышедших (последние два аниме-года),
 * с необязательным фильтром по жанру. Для главной страницы.
 */
export async function getTopRecent(
  genreId?: number,
  limit = 18,
): Promise<ShikimoriAnimeShort[]> {
  const year = new Date().getFullYear();
  const season = `${year - 1}_${year}`;
  const params = new URLSearchParams({
    order: 'ranked',
    season,
    kind: 'tv,movie,ona',
    limit: String(limit),
  });
  if (genreId) params.set('genre', String(genreId));
  return shikimoriFetch<ShikimoriAnimeShort[]>(
    `/animes?${params.toString()}`,
    3600,
  );
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

  return matches.slice(0, limit);
}

/** Полная карточка тайтла по id. */
export async function getAnime(
  id: number,
): Promise<ShikimoriAnimeFull> {
  return shikimoriFetch<ShikimoriAnimeFull>(`/animes/${id}`, 3600);
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

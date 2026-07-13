/**
 * Клиент Shikimori API.
 * Все запросы выполняются на сервере (Server Components / Route Handlers)
 * с обязательным User-Agent и щадящим rate limit (5 rps / 90 rpm).
 */

const BASE_URL = 'https://shikimori.one';
const API_URL = `${BASE_URL}/api`;
const USER_AGENT = 'AnimeWatch MVP';

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

/** Поиск по строке запроса. */
export async function searchAnime(
  query: string,
  limit = 20,
): Promise<ShikimoriAnimeShort[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  return shikimoriFetch<ShikimoriAnimeShort[]>(
    `/animes?search=${q}&limit=${limit}`,
    300,
  );
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

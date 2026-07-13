/**
 * Каталог фильмов и сериалов поверх Kodik API.
 *
 * Kodik сам агрегирует и русский (kinopoisk_id), и зарубежный (imdb_id) контент
 * с постерами/описаниями в `material_data` — поэтому отдельные каталоги
 * (Kinopoisk.dev / TMDB) не нужны, хватает одного KODIK_TOKEN.
 *
 * Внешний id раздела кино — kinopoisk_id: по нему Kodik ищет видео, и он же
 * пишется в watch_progress.shikimori_id при content_type='cinema'.
 *
 * Модуль исполняется ТОЛЬКО на сервере (токен не должен утекать в браузер).
 */

const KODIK_BASE = 'https://kodik-api.com';

/** Типы Kodik, которые показываем в разделе кино (без аниме). */
const CINEMA_TYPE_LIST = [
  'foreign-movie',
  'russian-movie',
  'soviet-cartoon',
  'foreign-cartoon',
  'russian-cartoon',
  'russian-serial',
  'foreign-serial',
  'cartoon-serial',
  'documentary-serial',
  'multi-part-film',
];
const CINEMA_TYPES = CINEMA_TYPE_LIST.join(',');
// Быстрая проверка типа. Нужна для /search: там фильтр `types` ломает выдачу
// (возвращает 0), поэтому аниме отсеиваем уже по результату.
const CINEMA_TYPE_SET = new Set(CINEMA_TYPE_LIST);

interface KodikMaterialData {
  title?: string;
  title_en?: string;
  poster_url?: string;
  description?: string;
  year?: number;
  kinopoisk_rating?: number;
  imdb_rating?: number;
  genres?: string[];
  countries?: string[];
  episodes_total?: number;
  duration?: number;
}

interface KodikItem {
  id: string;
  type: string;
  link: string;
  title: string;
  title_orig?: string;
  year?: number;
  kinopoisk_id?: string | null;
  imdb_id?: string | null;
  last_season?: number;
  last_episode?: number;
  episodes_count?: number;
  material_data?: KodikMaterialData;
}

interface KodikListResponse {
  results?: KodikItem[];
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

/** Полная карточка (страница тайтла). */
export interface CinemaFull extends CinemaShort {
  description: string | null;
  episodesTotal: number;
  genres: string[];
  countries: string[];
}

const KIND_LABELS: Record<string, string> = {
  'foreign-movie': 'Фильм',
  'russian-movie': 'Фильм',
  'multi-part-film': 'Фильм',
  'soviet-cartoon': 'Мультфильм',
  'foreign-cartoon': 'Мультфильм',
  'russian-cartoon': 'Мультфильм',
  'russian-serial': 'Сериал',
  'foreign-serial': 'Сериал',
  'documentary-serial': 'Документальный',
  'cartoon-serial': 'Мультсериал',
};

function token(): string | undefined {
  return process.env.KODIK_TOKEN;
}

async function kodikFetch(
  path: string,
  params: Record<string, string>,
  revalidate: number,
): Promise<KodikItem[]> {
  const t = token();
  if (!t) return []; // демо-режим без токена — каталог пуст, страница покажет заглушку
  const search = new URLSearchParams({ token: t, ...params });
  const res = await fetch(`${KODIK_BASE}${path}?${search.toString()}`, {
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`Kodik API error ${res.status} на ${path}`);
  const data = (await res.json()) as KodikListResponse;
  return data.results ?? [];
}

/** Число серий для тайтла: приоритет у объявленного total, иначе last_episode. */
function episodesOf(item: KodikItem): number {
  const total =
    item.material_data?.episodes_total ??
    item.episodes_count ??
    item.last_episode ??
    1;
  return total > 0 ? total : 1;
}

function toShort(item: KodikItem): CinemaShort | null {
  // Отсекаем аниме и прочие не-киношные типы (важно для /search без фильтра).
  if (!CINEMA_TYPE_SET.has(item.type)) return null;
  const kpId = Number(item.kinopoisk_id);
  const poster = item.material_data?.poster_url ?? null;
  // Без kinopoisk_id не сможем ни искать видео, ни хранить прогресс.
  if (!Number.isFinite(kpId) || kpId <= 0) return null;
  if (!poster) return null;

  const md = item.material_data;
  const rating =
    md?.kinopoisk_rating ?? md?.imdb_rating ?? null;

  return {
    id: kpId,
    title: item.title || md?.title || 'Без названия',
    poster,
    year: md?.year ?? item.year ?? null,
    kind: KIND_LABELS[item.type] ?? 'Фильм',
    isSerial: item.type.includes('serial') || episodesOf(item) > 1,
    rating: rating && rating > 0 ? Number(rating) : null,
  };
}

/**
 * Дедуп по kinopoisk_id (Kodik отдаёт по строке на каждую озвучку/сезон).
 * Берём первый валидный вариант с постером, сохраняя исходный порядок.
 */
function dedupe(items: KodikItem[], limit: number): CinemaShort[] {
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

/** Популярное для главной раздела кино. */
export async function getPopularCinema(limit = 18): Promise<CinemaShort[]> {
  // Берём с запасом (Kodik дублирует по озвучкам) и дедуплицируем.
  const items = await kodikFetch(
    '/list',
    {
      types: CINEMA_TYPES,
      with_material_data: 'true',
      sort: 'kinopoisk_rating',
      order: 'desc',
      limit: '100',
    },
    3600,
  );
  return dedupe(items, limit);
}

/** Поиск по строке запроса среди фильмов/сериалов. */
export async function searchCinema(
  query: string,
  limit = 20,
): Promise<CinemaShort[]> {
  const title = query.trim();
  if (!title) return [];
  // ВНИМАНИЕ: параметр `types` на /search обнуляет выдачу — не передаём его,
  // а не-киношные типы (аниме и т.п.) отсеиваем в toShort по CINEMA_TYPE_SET.
  const items = await kodikFetch(
    '/search',
    {
      title,
      with_material_data: 'true',
      limit: '100',
    },
    300,
  );
  return dedupe(items, limit);
}

/** Полная карточка тайтла по kinopoisk_id. */
export async function getCinemaById(
  kinopoiskId: number,
): Promise<CinemaFull | null> {
  const items = await kodikFetch(
    '/search',
    {
      kinopoisk_id: String(kinopoiskId),
      with_material_data: 'true',
      limit: '50',
    },
    600,
  );
  if (items.length === 0) return null;

  // Основой берём первый валидный, число серий — максимум по всем строкам.
  const base = items.find((i) => toShort(i)) ?? items[0];
  const short = toShort(base);
  if (!short) return null;

  const episodesTotal = Math.max(...items.map(episodesOf), 1);
  const md = base.material_data;

  return {
    ...short,
    isSerial: short.isSerial || episodesTotal > 1,
    description: md?.description ?? null,
    episodesTotal,
    genres: md?.genres ?? [],
    countries: md?.countries ?? [],
  };
}

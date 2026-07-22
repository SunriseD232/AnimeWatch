/**
 * Клиент TMDB (The Movie Database) — источник рейтинга (vote_average) и
 * трейлеров, которых нет в ответах Videoseed apiv2.php. Ищем по IMDb id
 * (он есть у большинства записей Videoseed через id_imdb), поэтому не нужен
 * отдельный маппинг id между сервисами.
 *
 * Без TMDB_API_KEY модуль просто возвращает null везде — категории и
 * страницы, которые запрашивают рейтинг/трейлер, откатываются к поведению
 * без него, ничего не ломается.
 */

const TMDB_API = 'https://api.themoviedb.org/3';

function apiKey(): string | undefined {
  return process.env.TMDB_API_KEY;
}

interface TmdbFindResult {
  movie_results: { id: number; vote_average?: number; vote_count?: number }[];
  tv_results: { id: number; vote_average?: number; vote_count?: number }[];
}

interface TmdbEntry {
  id: number;
  mediaType: 'movie' | 'tv';
  voteAverage: number | null;
}

/** Разово резолвит IMDb id → TMDB id + тип (movie/tv) + рейтинг. */
async function findTmdbEntry(imdbId: string): Promise<TmdbEntry | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetch(
      `${TMDB_API}/find/${imdbId}?external_source=imdb_id&api_key=${key}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as TmdbFindResult;
    const movie = data.movie_results[0];
    const tv = data.tv_results[0];
    const hit = movie ?? tv;
    if (!hit) return null;
    return {
      id: hit.id,
      mediaType: movie ? 'movie' : 'tv',
      // 0.0 без голосов вводил бы в заблуждение — лучше «рейтинга нет».
      voteAverage: hit.vote_count ? hit.vote_average ?? null : null,
    };
  } catch {
    return null;
  }
}

/** Рейтинг TMDB (0..10) по IMDb id. null — нет ключа/совпадения/голосов. */
export async function getTmdbRatingByImdbId(
  imdbId: string,
): Promise<number | null> {
  const entry = await findTmdbEntry(imdbId);
  return entry?.voteAverage ?? null;
}

interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official?: boolean;
}

/** YouTube-ключ трейлера: предпочитаем official, иначе первый попавшийся. */
function pickTrailerKey(videos: TmdbVideo[]): string | null {
  const trailers = videos.filter(
    (v) => v.site === 'YouTube' && v.type === 'Trailer',
  );
  if (trailers.length === 0) return null;
  return (trailers.find((v) => v.official) ?? trailers[0]).key;
}

async function fetchTrailerKey(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: TmdbVideo[] };
    return pickTrailerKey(data.results ?? []);
  } catch {
    return null;
  }
}

/**
 * YouTube-ключ трейлера по IMDb id. Для сериалов, если передан seasonNumber,
 * сперва пробуем трейлер именно этого сезона (`/tv/{id}/season/{n}/videos`) —
 * у TMDB он есть не для каждого сезона (проверено вживую: часто там просто
 * блуперы без Trailer), поэтому при пустом результате откатываемся на
 * трейлер всего шоу. Для фильмов seasonNumber игнорируется.
 */
export async function getTmdbTrailerByImdbId(
  imdbId: string,
  seasonNumber?: number,
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  const entry = await findTmdbEntry(imdbId);
  if (!entry) return null;

  if (entry.mediaType === 'movie') {
    return fetchTrailerKey(
      `${TMDB_API}/movie/${entry.id}/videos?api_key=${key}`,
    );
  }

  if (seasonNumber) {
    const seasonKey = await fetchTrailerKey(
      `${TMDB_API}/tv/${entry.id}/season/${seasonNumber}/videos?api_key=${key}`,
    );
    if (seasonKey) return seasonKey;
  }

  return fetchTrailerKey(`${TMDB_API}/tv/${entry.id}/videos?api_key=${key}`);
}

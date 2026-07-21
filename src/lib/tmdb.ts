/**
 * Клиент TMDB (The Movie Database) — используется ТОЛЬКО как источник рейтинга
 * (vote_average), которого нет в ответах Videoseed apiv2.php. Ищем по IMDb id
 * (он есть у большинства записей Videoseed через id_imdb), поэтому не нужен
 * отдельный маппинг id между сервисами.
 *
 * Без TMDB_API_KEY модуль просто возвращает null везде — категории, которые
 * запрашивают рейтинг, откатываются к порядку по умолчанию, ничего не ломается.
 */

const TMDB_API = 'https://api.themoviedb.org/3';

function apiKey(): string | undefined {
  return process.env.TMDB_API_KEY;
}

interface TmdbFindResult {
  movie_results: { vote_average?: number; vote_count?: number }[];
  tv_results: { vote_average?: number; vote_count?: number }[];
}

/**
 * Рейтинг TMDB (0..10) по IMDb id. null — нет ключа, не нашли соответствие,
 * или у найденной записи ещё нет голосов (0.0 в таком случае вводил бы в
 * заблуждение — лучше считать «рейтинга нет», как и у обычных записей).
 */
export async function getTmdbRatingByImdbId(
  imdbId: string,
): Promise<number | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetch(
      `${TMDB_API}/find/${imdbId}?external_source=imdb_id&api_key=${key}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as TmdbFindResult;
    const hit = data.movie_results[0] ?? data.tv_results[0];
    if (!hit || !hit.vote_count) return null;
    return hit.vote_average ?? null;
  } catch {
    return null;
  }
}

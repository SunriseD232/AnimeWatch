/**
 * Клиент TMDB (The Movie Database) — источник рейтинга (vote_average) и
 * трейлеров, которых нет в ответах Videoseed apiv2.php. Ищем по IMDb id
 * (он есть у большинства записей Videoseed через id_imdb), поэтому не нужен
 * отдельный маппинг id между сервисами.
 *
 * Без TMDB_API_KEY модуль просто возвращает null везде — категории и
 * страницы, которые запрашивают рейтинг/трейлер, откатываются к поведению
 * без него, ничего не ломается.
 *
 * api.themoviedb.org с этой VPS заблокирован на уровне DNS — проверено
 * вживую: и обычный DNS (8.8.8.8), и DNS-over-HTTPS (Cloudflare) отдают
 * отсюда 127.0.0.1/::1 для этого хоста (со стороннего хоста — настоящие IP
 * CloudFront), то есть блокировка именно на сетевом пути этой VPS, не у
 * самого TMDB. Тот же класс проблемы, что решили VLESS-туннелем для
 * Supabase/Real-Debrid — из-за неё рейтинги и трейлеры TMDB были тихо
 * сломаны (fetch падал в catch → null, без видимой ошибки) всё это время.
 */
import { vlessDispatcher } from '@/lib/net/vlessProxy';

const TMDB_API = 'https://api.themoviedb.org/3';
// См. VS_FETCH_TIMEOUT_MS в videoseed-catalog.ts — без таймаута зависший
// апстрим вешает страницу целиком.
const TMDB_FETCH_TIMEOUT_MS = 8_000;

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
      {
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS),
        // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
        dispatcher: vlessDispatcher(),
      },
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

/**
 * У Videoseed (см. videoseed-catalog.ts) нет поля со статусом сериала
 * (идёт/закончен) — а без него нельзя безопасно скрывать сериал из
 * «Продолжить просмотр» только по факту «дошёл до последней ИЗВЕСТНОЙ на
 * момент просмотра серии»: если сериал ещё выходит, это скрыло бы карточку
 * ровно в тот момент, когда должна выйти новая серия. TMDB даёт статус по
 * тому же IMDb id, что уже резолвится для рейтинга/трейлера.
 *
 * true — идёт (Returning Series/In Production/Planned/Pilot), false —
 * завершён (Ended/Canceled), null — не удалось определить (нет ключа, не
 * найден в TMDB, это не сериал) — в этом случае вызывающий код НЕ должен
 * скрывать карточку (безопасный дефолт — лучше лишняя карточка, чем
 * потерянный онгоинг).
 */
export async function getTmdbSeriesOngoing(
  imdbId: string,
): Promise<boolean | null> {
  const key = apiKey();
  if (!key) return null;
  const entry = await findTmdbEntry(imdbId);
  if (!entry || entry.mediaType !== 'tv') return null;
  try {
    const res = await fetch(`${TMDB_API}/tv/${entry.id}?api_key=${key}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS),
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: vlessDispatcher(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string };
    if (!data.status) return null;
    return ['Returning Series', 'In Production', 'Planned', 'Pilot'].includes(data.status);
  } catch {
    return null;
  }
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
    const res = await fetch(url, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS),
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: vlessDispatcher(),
    });
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

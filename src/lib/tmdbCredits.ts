import { vlessDispatcher } from '@/lib/net/vlessProxy';
import { getCachedJson } from './cache/apiCache';
import {
  CREW_JOB_LABELS_RU,
  FEATURED_CREW_JOBS,
  tmdbImageUrl,
  type CinemaCastMember,
  type CinemaCompanyRef,
  type CinemaCredits,
  type CinemaCrewMember,
} from './tmdbCreditsShared';

// Реэкспорт — серверные вызывающие (cinemaRatings.ts, страницы персоны/
// компании) продолжают импортировать всё отсюда, одним местом; клиентские
// компоненты (CinemaTitleCredits.tsx) — напрямую из tmdbCreditsShared.ts,
// не утаскивая в бандл vlessDispatcher/undici (см. её комментарий).
export { CREW_JOB_LABELS_RU, FEATURED_CREW_JOBS, tmdbImageUrl };
export type { CinemaCastMember, CinemaCompanyRef, CinemaCredits, CinemaCrewMember };

/**
 * Съёмочная группа/каст TMDB для кино и сериалов (см. ТЗ «связанные
 * страницы персон и студий» — фаза 2, после аниме/Shikimori).
 *
 * Два разных пути, как и у Shikimori:
 *  - Карточка тайтла (кино/сериал) — CinemaCredits, кэшируется ЗАРАНЕЕ в
 *    cinema_ratings.credits тем же недельным кроном, что и рейтинг (см.
 *    fetchTmdbCreditsForCron, вызывается из lib/cinemaRatings.ts). Страница
 *    тайтла TMDB напрямую НЕ дёргает — она и раньше этого не делала (см.
 *    app/cinema/[id]/page.tsx, getCinemaById читает только Videoseed).
 *  - Страницы персоны/компании — читаются "вживую" на рендере, но через
 *    общий api_response_cache (getCachedJson), как и у Shikimori.
 *
 * ВАЖНОЕ ОТЛИЧИЕ ОТ АНИМЕ: у сайта нет своего id-пространства TMDB — тайтлы
 * кино/сериалов на сайте живут под kp_id (Kinopoisk, из Videoseed). Каждая
 * запись фильмографии персоны/компании из TMDB несёт TMDB id, а не kp_id —
 * ссылку на /cinema/:id можно поставить только для того, что резолвится в
 * kp_id через getKpIdsByTmdbIds (lib/cinemaIndexQuery.ts, использует уже
 * существующую колонку cinema_index.tmdb_id — без похода в TMDB). Тайтлов,
 * которых нет в каталоге Videoseed, на сайте всё равно посмотреть негде —
 * такие записи в выдаче просто пропускаются, а не показываются мёртвой
 * ссылкой.
 */

const TMDB_API = 'https://api.themoviedb.org/3';

const CRON_FETCH_TIMEOUT_MS = 15_000;
const READ_FETCH_TIMEOUT_MS = 8_000;
const PERSON_TTL_SECONDS = 24 * 60 * 60;
const COMPANY_TTL_SECONDS = 24 * 60 * 60;
const DISCOVER_TTL_SECONDS = 6 * 60 * 60;
const CAST_LIMIT = 12;

interface RawCompany {
  id: number;
  name: string;
  logo_path: string | null;
}

interface RawMovieCredits {
  production_companies?: RawCompany[];
  credits?: {
    cast?: { id: number; name: string; character?: string; profile_path: string | null }[];
    crew?: { id: number; name: string; job?: string; profile_path: string | null }[];
  };
}

interface RawTvCredits {
  production_companies?: RawCompany[];
  created_by?: { id: number; name: string; profile_path: string | null }[];
  aggregate_credits?: {
    cast?: {
      id: number;
      name: string;
      roles?: { character: string }[];
      profile_path: string | null;
    }[];
    crew?: {
      id: number;
      name: string;
      jobs?: { job: string }[];
      profile_path: string | null;
    }[];
  };
}

/**
 * Один запрос за карточку тайтла для крона (см. lib/cinemaRatings.ts) — не
 * кэшируется через getCachedJson (как и остальной cinemaRatings.ts: за
 * прогон проходят тысячи разных id, кэшировать их значило бы раздувать
 * api_response_cache тем же тиражом, что и саму cinema_ratings). null —
 * сетевая неудача, вызывающий код просто не отмечает тайтл проверенным и
 * повторит на следующей неделе (та же семантика, что у fetchRating).
 */
export async function fetchTmdbCreditsForCron(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  apiKey: string,
): Promise<CinemaCredits | null> {
  try {
    const append = mediaType === 'movie' ? 'credits' : 'aggregate_credits';
    const res = await fetch(
      `${TMDB_API}/${mediaType}/${tmdbId}?api_key=${apiKey}&append_to_response=${append}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
        // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
        dispatcher: vlessDispatcher(),
      },
    );
    if (!res.ok) return null;

    if (mediaType === 'movie') {
      const data = (await res.json()) as RawMovieCredits;
      const companies: CinemaCompanyRef[] = (data.production_companies ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        logoPath: c.logo_path,
      }));
      const cast: CinemaCastMember[] = (data.credits?.cast ?? []).slice(0, CAST_LIMIT).map((c) => ({
        id: c.id,
        name: c.name,
        character: c.character ?? '',
        profilePath: c.profile_path,
      }));
      const crew: CinemaCrewMember[] = (data.credits?.crew ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        job: c.job ?? '',
      }));
      return { cast, crew, companies };
    }

    const data = (await res.json()) as RawTvCredits;
    const companies: CinemaCompanyRef[] = (data.production_companies ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      logoPath: c.logo_path,
    }));
    const cast: CinemaCastMember[] = (data.aggregate_credits?.cast ?? [])
      .slice(0, CAST_LIMIT)
      .map((c) => ({
        id: c.id,
        name: c.name,
        character: c.roles?.[0]?.character ?? '',
        profilePath: c.profile_path,
      }));
    // created_by (создатели сериала) — ближайший аналог «режиссёра» у TMDB
    // для сериалов: там режиссёр назначается на каждый эпизод отдельно, а не
    // на шоу целиком.
    const creators: CinemaCrewMember[] = (data.created_by ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      job: 'Creator',
    }));
    const crew: CinemaCrewMember[] = (data.aggregate_credits?.crew ?? []).flatMap((c) =>
      (c.jobs ?? []).map((j) => ({ id: c.id, name: c.name, job: j.job })),
    );
    return { cast, crew: [...creators, ...crew], companies };
  } catch {
    return null;
  }
}

async function tmdbGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('нет TMDB_API_KEY');
  const qs = new URLSearchParams({ api_key: key, ...params }).toString();
  const res = await fetch(`${TMDB_API}${path}?${qs}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(READ_FETCH_TIMEOUT_MS),
    // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
    dispatcher: vlessDispatcher(),
  });
  if (!res.ok) throw new Error(`TMDB API error ${res.status} на ${path}`);
  return (await res.json()) as T;
}

export interface TmdbPersonCreditItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  /** 'Актёр' у актёрских кредитов, должность (переведённая где есть перевод)
   *  у съёмочной группы — группировка вкладок на странице персоны. */
  role: string;
  /** Имя персонажа — только у актёрских кредитов. */
  character: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
}

export interface TmdbPerson {
  id: number;
  name: string;
  biography: string | null;
  profilePath: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  knownForDepartment: string | null;
  credits: TmdbPersonCreditItem[];
}

interface RawPersonCreditBase {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

interface RawPerson {
  id: number;
  name: string;
  biography: string | null;
  profile_path: string | null;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  known_for_department: string | null;
  combined_credits?: {
    cast?: (RawPersonCreditBase & { character?: string })[];
    crew?: (RawPersonCreditBase & { job?: string })[];
  };
}

function creditTitle(item: RawPersonCreditBase): string {
  return item.title ?? item.name ?? '';
}

function creditDate(item: RawPersonCreditBase): string | null {
  return item.release_date || item.first_air_date || null;
}

export async function getTmdbPersonFilmography(personId: number): Promise<TmdbPerson | null> {
  try {
    return await getCachedJson(`tmdb:person:${personId}`, PERSON_TTL_SECONDS, async () => {
      const data = await tmdbGet<RawPerson>(`/person/${personId}`, {
        append_to_response: 'combined_credits',
        language: 'ru-RU',
      });

      const castCredits: TmdbPersonCreditItem[] = (data.combined_credits?.cast ?? []).map((c) => ({
        tmdbId: c.id,
        mediaType: c.media_type,
        title: creditTitle(c),
        role: 'Актёр',
        character: c.character ?? null,
        posterPath: c.poster_path,
        releaseDate: creditDate(c),
        voteAverage: c.vote_average ?? null,
      }));
      const crewCredits: TmdbPersonCreditItem[] = (data.combined_credits?.crew ?? []).map((c) => ({
        tmdbId: c.id,
        mediaType: c.media_type,
        title: creditTitle(c),
        role: (c.job && CREW_JOB_LABELS_RU[c.job]) || c.job || 'Съёмочная группа',
        character: null,
        posterPath: c.poster_path,
        releaseDate: creditDate(c),
        voteAverage: c.vote_average ?? null,
      }));

      return {
        id: data.id,
        name: data.name,
        biography: data.biography || null,
        profilePath: data.profile_path,
        birthday: data.birthday,
        deathday: data.deathday,
        placeOfBirth: data.place_of_birth,
        knownForDepartment: data.known_for_department,
        credits: [...castCredits, ...crewCredits],
      };
    });
  } catch {
    return null;
  }
}

export interface TmdbCompany {
  id: number;
  name: string;
  logoPath: string | null;
  description: string | null;
  originCountry: string | null;
}

interface RawTmdbCompany {
  id: number;
  name: string;
  logo_path: string | null;
  description: string | null;
  origin_country: string | null;
}

export async function getTmdbCompany(companyId: number): Promise<TmdbCompany | null> {
  try {
    return await getCachedJson(`tmdb:company:${companyId}`, COMPANY_TTL_SECONDS, async () => {
      const data = await tmdbGet<RawTmdbCompany>(`/company/${companyId}`, {});
      return {
        id: data.id,
        name: data.name,
        logoPath: data.logo_path,
        description: data.description || null,
        originCountry: data.origin_country || null,
      };
    });
  } catch {
    return null;
  }
}

export type CompanyMediaType = 'movie' | 'tv';
export type CompanySort = 'popularity.desc' | 'vote_average.desc' | 'primary_release_date.desc';

export interface CompanyDiscoverItem {
  tmdbId: number;
  mediaType: CompanyMediaType;
}

/** Один запрос — одна страница TMDB discover (нет собственной агрегации:
 *  результат может частично не найтись в getKpIdsByTmdbIds, вызывающая
 *  страница просто покажет меньше карточек на такой странице — тот же
 *  честный компромисс, что и у пустых страниц студии Shikimori. */
export async function getTmdbCompanyDiscoverPage(
  companyId: number,
  opts: { mediaType?: CompanyMediaType; page?: number; sort?: CompanySort } = {},
): Promise<CompanyDiscoverItem[]> {
  const mediaType = opts.mediaType ?? 'movie';
  const page = opts.page ?? 1;
  const sort = opts.sort ?? 'popularity.desc';
  try {
    return await getCachedJson(
      `tmdb:company-discover:${companyId}:${mediaType}:${page}:${sort}`,
      DISCOVER_TTL_SECONDS,
      async () => {
        const dateField = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
        const sortBy = sort === 'primary_release_date.desc' ? `${dateField}.desc` : sort;
        const data = await tmdbGet<{ results?: { id: number }[] }>(`/discover/${mediaType}`, {
          with_companies: String(companyId),
          page: String(page),
          sort_by: sortBy,
        });
        return (data.results ?? []).map((r) => ({ tmdbId: r.id, mediaType }));
      },
    );
  } catch {
    return [];
  }
}

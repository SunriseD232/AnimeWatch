/**
 * Часть tmdbCredits.ts без сетевых/серверных зависимостей — типы, лейблы
 * ролей, сборка URL картинки. Вынесено отдельно по той же причине, что и
 * shikimoriShared.ts (см. его комментарий): CinemaTitleCredits.tsx —
 * клиентский компонент, и раньше он импортировал это прямо из
 * tmdbCredits.ts, которая тянет vlessDispatcher → undici → node:-модули —
 * сборка падала на попытке засунуть их в клиентский бандл.
 */

/** job (английский, как отдаёт TMDB — не локализуется) → русская подпись
 *  для курируемого блока на карточке тайтла (см. CinemaTitleCredits.tsx). */
export const CREW_JOB_LABELS_RU: Record<string, string> = {
  Director: 'Режиссёр',
  Screenplay: 'Сценарий',
  Writer: 'Сценарий',
  Story: 'Автор истории',
  Novel: 'Автор оригинала',
  'Original Music Composer': 'Композитор',
  Creator: 'Создатель',
};

export const FEATURED_CREW_JOBS = Object.keys(CREW_JOB_LABELS_RU);

export interface CinemaCastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
}

export interface CinemaCrewMember {
  id: number;
  name: string;
  job: string;
}

export interface CinemaCompanyRef {
  id: number;
  name: string;
  logoPath: string | null;
}

export interface CinemaCredits {
  cast: CinemaCastMember[];
  crew: CinemaCrewMember[];
  companies: CinemaCompanyRef[];
}

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** Абсолютный URL картинки TMDB (постер/фото персоны/лого компании) —
 *  сами эти пути в ответах TMDB относительные, размер задаётся в URL. */
export function tmdbImageUrl(path: string | null, size: 'w185' | 'w300' = 'w185'): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

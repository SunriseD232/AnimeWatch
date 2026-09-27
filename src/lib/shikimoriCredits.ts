import { getCachedJson } from './cache/apiCache';
import { imageUrl, shikimoriFetch, shikimoriGraphQL } from './shikimori';

/**
 * Персонал, студия, персоны и студии Shikimori — карточка тайтла аниме
 * (см. ТЗ «связанные страницы персон и студий»).
 *
 * REST /animes/:id (getAnime в shikimori.ts) НЕ отдаёт ни personRoles, ни
 * studios — единственный способ получить их одним запросом это GraphQL
 * (проверено вживую). А вот полную фильмографию персоны и список студий
 * REST отдаёт готовыми, агрегировать самим ничего не нужно:
 *  - GET /api/people/:id — весь послужной список персоны разом (roles+works).
 *  - GET /api/studios — статичный список ВСЕХ студий (id/name/image), без
 *    постраничности и без отдельного /studios/:id — ищем нужную по id
 *    в этом списке.
 *  - GET /api/animes?studio=ID — обычный постраничный каталог тайтлов
 *    студии, тот же формат, что и везде у Shikimori.
 *
 * Кэш — общий api_response_cache (см. lib/cache/apiCache.ts), а не таблицы
 * под фичу: данные меняются очень редко (титры/студия тайтла не правятся
 * за сутки), новых миграций эта фича не требует вовсе.
 */

const REST_TTL_SECONDS = 24 * 60 * 60;
const STUDIOS_LIST_TTL_SECONDS = 24 * 60 * 60;
const STUDIO_ANIMES_TTL_SECONDS = 60 * 60;

/**
 * Роли из personRoles, которые показываем прямо в карточке тайтла (в
 * порядке отображения). Остальные ~100+ ролей (ключевая анимация,
 * промежуточная анимация, ADR-режиссёры дубляжа и т.д.) — только в
 * allStaff, под разворотом «Показать всю съёмочную группу».
 */
const FEATURED_ROLES = [
  'Режиссёр',
  'Сценарий',
  'Автор оригинала',
  'Дизайн персонажей',
  'Композитор гл. муз. темы',
  'Музыка',
] as const;

export interface CreditPerson {
  personId: number;
  name: string;
}

export interface CreditStudio {
  studioId: number;
  name: string;
}

export interface StaffEntry {
  rolesRu: string[];
  personId: number;
  name: string;
}

export interface AnimeCredits {
  featured: { role: string; people: CreditPerson[] }[];
  studios: CreditStudio[];
  allStaff: StaffEntry[];
}

interface GqlPersonStub {
  id: string;
  name: string;
  russian: string | null;
}

interface GqlPersonRole {
  rolesRu: string[];
  person: GqlPersonStub | null;
}

interface GqlStudio {
  id: string;
  name: string;
}

interface GqlAnimeCredits {
  personRoles: GqlPersonRole[];
  studios: GqlStudio[];
}

export async function getAnimeCredits(shikimoriId: number): Promise<AnimeCredits | null> {
  try {
    return await getCachedJson(`shikimori:credits:anime:${shikimoriId}`, REST_TTL_SECONDS, async () => {
      const data = await shikimoriGraphQL<{ animes: GqlAnimeCredits[] }>(
        `query { animes(ids: "${shikimoriId}") { personRoles { rolesRu person { id name russian } } studios { id name } } }`,
      );
      const anime = data.animes[0];
      if (!anime) return null;

      const allStaff: StaffEntry[] = anime.personRoles
        .filter((r): r is GqlPersonRole & { person: GqlPersonStub } => r.person != null)
        .map((r) => ({
          rolesRu: r.rolesRu,
          personId: Number(r.person.id),
          name: r.person.russian || r.person.name,
        }));

      const featured = FEATURED_ROLES.map((role) => ({
        role,
        people: allStaff
          .filter((s) => s.rolesRu.includes(role))
          .map((s) => ({ personId: s.personId, name: s.name })),
      })).filter((g) => g.people.length > 0);

      const studios: CreditStudio[] = anime.studios.map((s) => ({
        studioId: Number(s.id),
        name: s.name,
      }));

      return { featured, studios, allStaff };
    });
  } catch {
    return null;
  }
}

// Форма совпадает с ShikimoriAnimeShort (lib/shikimoriShared.ts) — так эти
// тайтлы можно рендерить существующим AnimeCard без адаптера, с той же
// кнопкой «+» (список/просмотрено), что и в каталоге.
export interface ShikimoriPersonAnime {
  id: number;
  name: string;
  russian: string;
  image: { original: string; preview: string; x96: string; x48: string };
  url: string;
  kind: string | null;
  score: string;
  status: string;
  episodes: number;
  episodes_aired: number;
  aired_on: string | null;
  released_on: string | null;
}

export interface ShikimoriPersonWork {
  role: string;
  anime: ShikimoriPersonAnime | null;
  manga: unknown | null;
}

export interface ShikimoriPerson {
  id: number;
  name: string;
  russian: string | null;
  japanese: string | null;
  image: { original: string; preview: string } | null;
  job_title: string | null;
  birth_on: { day: number | null; year: number | null; month: number | null } | null;
  website: string | null;
  groupped_roles: [string, number][];
  // roles[] — только у сэйю (озвучка), другая форма (characters[]+animes[]
  // без role/manga) и вне MVP-скоупа (см. shikimoriCredits.ts вверху файла
  // — блок сэйю сознательно пропущен: у Shikimori нет тега языка озвучки).
  // Не типизируем и не читаем.
  roles: unknown[];
  works: ShikimoriPersonWork[];
}

export async function getPersonFilmography(personId: number): Promise<ShikimoriPerson | null> {
  try {
    return await getCachedJson(`shikimori:person:${personId}`, REST_TTL_SECONDS, () =>
      shikimoriFetch<ShikimoriPerson>(`/people/${personId}`, REST_TTL_SECONDS),
    );
  } catch {
    return null;
  }
}

/** Фильмография персоны — только тайтлы-аниме (не манга, у сайта нет
 *  страниц манги — ссылку поставить было бы некуда) с реальной ролью. */
export function getPersonAnimeWorks(person: ShikimoriPerson): (ShikimoriPersonWork & {
  anime: ShikimoriPersonAnime;
})[] {
  return person.works.filter(
    (w): w is ShikimoriPersonWork & { anime: ShikimoriPersonAnime } => w.anime != null,
  );
}

interface ShikimoriStudioStub {
  id: number;
  name: string;
  filtered_name: string;
  real: boolean;
  image: string | null;
}

async function getAllStudios(): Promise<ShikimoriStudioStub[]> {
  return getCachedJson('shikimori:studios:all', STUDIOS_LIST_TTL_SECONDS, () =>
    shikimoriFetch<ShikimoriStudioStub[]>('/studios', STUDIOS_LIST_TTL_SECONDS),
  );
}

export type StudioOrder = 'popularity' | 'ranked' | 'aired_on';

export interface StudioPage {
  studioId: number;
  name: string;
  imageUrl: string | null;
  page: number;
  order: StudioOrder;
  animes: ShikimoriPersonAnime[];
}

export async function getStudio(
  studioId: number,
  opts: { page?: number; order?: StudioOrder } = {},
): Promise<StudioPage | null> {
  const page = opts.page ?? 1;
  const order = opts.order ?? 'popularity';
  try {
    const studios = await getAllStudios();
    const studio = studios.find((s) => s.id === studioId);
    if (!studio) return null;

    const animes = await getCachedJson(
      `shikimori:studio-animes:${studioId}:${page}:${order}`,
      STUDIO_ANIMES_TTL_SECONDS,
      () =>
        shikimoriFetch<ShikimoriPersonAnime[]>(
          `/animes?studio=${studioId}&page=${page}&limit=24&order=${order}`,
          STUDIO_ANIMES_TTL_SECONDS,
        ),
    );

    return {
      studioId,
      name: studio.name,
      imageUrl: imageUrl(studio.image),
      page,
      order,
      animes,
    };
  } catch {
    return null;
  }
}

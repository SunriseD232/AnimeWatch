import { notFound } from 'next/navigation';
import PersonFilmography from '@/components/PersonFilmography';
import CinemaFilmography, { type CinemaFilmographyEntry } from '@/components/CinemaFilmography';
import AnimeCard from '@/components/AnimeCard';
import CinemaCard from '@/components/CinemaCard';
import { imageUrl } from '@/lib/shikimori';
import { getPersonAnimeWorks, getPersonFilmography } from '@/lib/shikimoriCredits';
import { getTmdbPersonFilmography, tmdbImageUrl } from '@/lib/tmdbCredits';
import { getCinemaIndexByIds, getKpIdsByTmdbIds } from '@/lib/cinemaIndexQuery';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatBirth(birth: { day: number | null; year: number | null; month: number | null } | null): string | null {
  if (!birth?.year) return null;
  if (birth.day && birth.month) return `${birth.day} ${MONTHS[birth.month - 1]} ${birth.year}`;
  return String(birth.year);
}

/** TMDB отдаёт даты строкой ISO (YYYY-MM-DD), не разбито по полям, как
 *  Shikimori — отдельный, более простой форматтер. */
function formatIsoDate(iso: string | null): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  if (!year) return null;
  if (day && month) return `${day} ${MONTHS[month - 1]} ${year}`;
  return String(year);
}

async function ShikimoriPersonSection({ personId }: { personId: number }) {
  const person = await getPersonFilmography(personId);
  if (!person) notFound();

  const name = person.russian || person.name;
  const photo = imageUrl(person.image?.original);
  const birthLabel = formatBirth(person.birth_on);
  const works = getPersonAnimeWorks(person);

  const topWorks = [...works]
    .filter((w) => Number(w.anime.score) > 0)
    .sort((a, b) => Number(b.anime.score) - Number(a.anime.score))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
        <div className="h-32 w-32 shrink-0 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-500">Нет фото</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:items-start">
          <h1 className="max-w-full text-3xl font-bold leading-tight [overflow-wrap:anywhere]">{name}</h1>
          {person.name !== name && <p className="text-sm text-gray-400">{person.name}</p>}
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-gray-400 sm:justify-start">
            {person.job_title && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">{person.job_title}</span>
            )}
            {birthLabel && <span>Дата рождения: {birthLabel}</span>}
          </div>
          <p className="text-sm text-gray-400">Тайтлов в фильмографии: {works.length}</p>
        </div>
      </section>

      {topWorks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Лучшие работы</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {topWorks.map((w) => (
              <AnimeCard key={`top-${w.anime.id}`} anime={w.anime} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Фильмография</h2>
        {works.length > 0 ? (
          <PersonFilmography works={works} />
        ) : (
          <p className="text-sm text-gray-400">У этой персоны пока нет тайтлов в базе Shikimori.</p>
        )}
      </section>
    </div>
  );
}

async function TmdbPersonSection({ personId }: { personId: number }) {
  const person = await getTmdbPersonFilmography(personId);
  if (!person) notFound();

  const photo = tmdbImageUrl(person.profilePath, 'w300');
  const birthLabel = formatIsoDate(person.birthday);

  // TMDB отдаёт фильмографию по СВОИМ id — сайт открывает только свой
  // каталог по kp_id (Kinopoisk). Резолвим то, что реально есть у нас (см.
  // getKpIdsByTmdbIds — по колонке cinema_index.tmdb_id, без похода в TMDB),
  // и молча пропускаем то, чего в каталоге Videoseed нет — показывать
  // карточку без рабочей ссылки было бы хуже, чем не показывать её вовсе.
  const tmdbIds = [...new Set(person.credits.map((c) => c.tmdbId))];
  const kpByTmdb = await getKpIdsByTmdbIds(tmdbIds);
  const kpIds = [...new Set([...kpByTmdb.values()])];
  const items = await getCinemaIndexByIds(kpIds);
  const itemByKpId = new Map(items.map((i) => [i.id, i]));

  const entries: CinemaFilmographyEntry[] = person.credits
    .map((c) => {
      const kpId = kpByTmdb.get(c.tmdbId);
      const item = kpId != null ? itemByKpId.get(kpId) : undefined;
      if (!item) return null;
      return { role: c.role, character: c.character, item };
    })
    .filter((e): e is CinemaFilmographyEntry => e != null);

  const topEntries = [...entries]
    .filter((e) => (e.item.rating ?? 0) > 0)
    .sort((a, b) => (b.item.rating ?? 0) - (a.item.rating ?? 0))
    .filter((e, i, arr) => arr.findIndex((x) => x.item.id === e.item.id) === i)
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
        <div className="h-32 w-32 shrink-0 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={person.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-500">Нет фото</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:items-start">
          <h1 className="max-w-full text-3xl font-bold leading-tight [overflow-wrap:anywhere]">{person.name}</h1>
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-gray-400 sm:justify-start">
            {person.knownForDepartment && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">{person.knownForDepartment}</span>
            )}
            {birthLabel && <span>Дата рождения: {birthLabel}</span>}
          </div>
          {person.biography && (
            <p className="max-w-2xl text-sm text-gray-400 [overflow-wrap:anywhere]">
              {person.biography.length > 400 ? `${person.biography.slice(0, 400)}…` : person.biography}
            </p>
          )}
          <p className="text-sm text-gray-400">Тайтлов на сайте: {entries.length}</p>
        </div>
      </section>

      {topEntries.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Лучшие работы</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {topEntries.map((e) => (
              <CinemaCard key={`top-${e.item.id}`} item={e.item} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Фильмография</h2>
        {entries.length > 0 ? (
          <CinemaFilmography entries={entries} />
        ) : (
          <p className="text-sm text-gray-400">Ни один тайтл с участием этой персоны не найден в каталоге сайта.</p>
        )}
      </section>
    </div>
  );
}

/**
 * Страница персоны (см. ТЗ «связанные страницы персон и студий»). `source`
 * различает Shikimori (аниме, фаза 1) и TMDB (кино/сериалы, фаза 2) — id из
 * этих двух API живут в непересекающихся пространствах, общего справочника
 * персон нет ни у кого из них.
 */
export default async function PersonPage({
  params,
}: {
  params: { source: string; id: string };
}) {
  const personId = Number(params.id);
  if (!Number.isFinite(personId)) notFound();

  if (params.source === 'shikimori') return <ShikimoriPersonSection personId={personId} />;
  if (params.source === 'tmdb') return <TmdbPersonSection personId={personId} />;
  notFound();
}

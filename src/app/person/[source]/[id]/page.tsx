import { notFound } from 'next/navigation';
import PersonFilmography from '@/components/PersonFilmography';
import AnimeCard from '@/components/AnimeCard';
import { imageUrl } from '@/lib/shikimori';
import { getPersonAnimeWorks, getPersonFilmography } from '@/lib/shikimoriCredits';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatBirth(birth: { day: number | null; year: number | null; month: number | null } | null): string | null {
  if (!birth?.year) return null;
  if (birth.day && birth.month) return `${birth.day} ${MONTHS[birth.month - 1]} ${birth.year}`;
  return String(birth.year);
}

/**
 * Страница персоны (см. ТЗ «связанные страницы персон и студий»). `source`
 * пока принимает только 'shikimori' — TMDB-персоны кино приедут отдельной
 * фазой (см. план), префикс в урле уже сейчас, чтобы потом не переезжать.
 */
export default async function PersonPage({
  params,
}: {
  params: { source: string; id: string };
}) {
  if (params.source !== 'shikimori') notFound();
  const personId = Number(params.id);
  if (!Number.isFinite(personId)) notFound();

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

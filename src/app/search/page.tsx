import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { searchAnime } from '@/lib/shikimori';

export const metadata = { title: 'Поиск — AnimeWatch' };

async function Results({ query }: { query: string }) {
  try {
    const animes = await searchAnime(query, 20);
    if (animes.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          По запросу «{query}» ничего не найдено.
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {animes.map((a) => (
          <AnimeCard key={a.id} anime={a} />
        ))}
      </div>
    );
  } catch {
    return (
      <p className="rounded-xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Ошибка поиска. Попробуйте ещё раз.
      </p>
    );
  }
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const query = (searchParams.q ?? '').trim();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">
        {query ? (
          <>
            Результаты по запросу{' '}
            <span className="text-accent">«{query}»</span>
          </>
        ) : (
          'Поиск аниме'
        )}
      </h1>

      {query ? (
        <Suspense key={query} fallback={<CardGridSkeleton count={12} />}>
          <Results query={query} />
        </Suspense>
      ) : (
        <p className="text-sm text-gray-400">
          Введите название в строке поиска сверху.
        </p>
      )}
    </div>
  );
}

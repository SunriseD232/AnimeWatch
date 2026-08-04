import Link from 'next/link';
import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import CinemaCard from '@/components/CinemaCard';
import { CardGridSkeleton } from '@/components/Skeletons';
import { searchCinema } from '@/lib/videoseed-catalog';
import { searchAnime } from '@/lib/shikimori';

export const metadata = { title: 'Поиск — MediaWatch' };

async function AnimeResults({ query }: { query: string }) {
  try {
    const animes = await searchAnime(query, 20);
    if (animes.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          По запросу «{query}» ничего не найдено.{' '}
          <Link href="/catalog" className="text-accent hover:underline">
            Посмотрите каталог
          </Link>
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
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Ошибка поиска. Попробуйте ещё раз.
      </p>
    );
  }
}

async function CinemaResults({ query }: { query: string }) {
  try {
    const items = await searchCinema(query, 20);
    if (items.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          По запросу «{query}» ничего не найдено.{' '}
          <Link href="/cinema/catalog" className="text-accent hover:underline">
            Посмотрите каталог
          </Link>
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <CinemaCard key={item.id} item={item} />
        ))}
      </div>
    );
  } catch {
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Ошибка поиска. Попробуйте ещё раз.
      </p>
    );
  }
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  const isCinema = searchParams.type === 'cinema';
  const noun = isCinema ? 'фильмов и сериалов' : 'аниме';
  // Все остальные страницы сайта показывают переключатель Аниме/Кино
  // (ModeSwitch) — на поиске его не было вообще, переключить тип запроса
  // можно было только вручную правкой ?type= в адресной строке.
  const typeHref = (type: 'anime' | 'cinema') => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (type === 'cinema') params.set('type', 'cinema');
    const qs = params.toString();
    return qs ? `/search?${qs}` : '/search';
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-fit rounded-full border border-white/10 bg-bg-card p-1">
        <Link
          href={typeHref('anime')}
          aria-current={!isCinema ? 'page' : undefined}
          className={[
            'press rounded-full px-4 py-2 text-sm font-medium transition',
            !isCinema ? 'bg-accent text-white' : 'text-gray-300 hover:bg-bg-soft hover:text-white',
          ].join(' ')}
        >
          Аниме
        </Link>
        <Link
          href={typeHref('cinema')}
          aria-current={isCinema ? 'page' : undefined}
          className={[
            'press rounded-full px-4 py-2 text-sm font-medium transition',
            isCinema ? 'bg-accent text-white' : 'text-gray-300 hover:bg-bg-soft hover:text-white',
          ].join(' ')}
        >
          Фильмы и сериалы
        </Link>
      </div>

      <h1 className="text-xl font-bold">
        {query ? (
          <>
            Результаты по запросу{' '}
            <span className="text-accent">«{query}»</span>
          </>
        ) : (
          `Поиск ${noun}`
        )}
      </h1>

      {query ? (
        <Suspense
          key={`${isCinema ? 'c' : 'a'}:${query}`}
          fallback={<CardGridSkeleton count={12} />}
        >
          {isCinema ? (
            <CinemaResults query={query} />
          ) : (
            <AnimeResults query={query} />
          )}
        </Suspense>
      ) : (
        <p className="text-sm text-gray-400">
          Введите название в строке поиска сверху.
        </p>
      )}
    </div>
  );
}

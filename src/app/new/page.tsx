import Link from 'next/link';
import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import ModeSwitch from '@/components/ModeSwitch';
import { CardGridSkeleton } from '@/components/Skeletons';
import { getNewAnime } from '@/lib/shikimori';

export const metadata = { title: 'Новинки — MediaWatch' };

const PAGE_SIZE = 24;

async function NewGrid({ page }: { page: number }) {
  let data;
  try {
    data = await getNewAnime(page, PAGE_SIZE);
  } catch {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Shikimori. Попробуйте обновить страницу
        позже.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {page > 1 ? 'Дальше ничего нет.' : 'Новинок пока нет.'}
      </div>
    );
  }

  const hasPrev = page > 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((a) => (
          <AnimeCard key={a.id} anime={a} />
        ))}
      </div>

      <div className="flex items-center justify-center gap-2">
        <Link
          href={hasPrev ? `/new?page=${page - 1}` : '#'}
          aria-disabled={!hasPrev}
          className={[
            'rounded-full px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
            hasPrev
              ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
              : 'pointer-events-none bg-bg-card/50 text-gray-600',
          ].join(' ')}
        >
          ← Пред.
        </Link>
        <span className="px-2 text-sm text-gray-400">Стр. {page}</span>
        <Link
          href={data.hasMore ? `/new?page=${page + 1}` : '#'}
          aria-disabled={!data.hasMore}
          className={[
            'rounded-full px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
            data.hasMore
              ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
              : 'pointer-events-none bg-bg-card/50 text-gray-600',
          ].join(' ')}
        >
          След. →
        </Link>
      </div>
    </div>
  );
}

export default function NewAnimePage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="anime" />

      <div>
        <h1 className="text-xl font-bold">Новинки</h1>
        <p className="text-sm text-gray-400">
          Последние вышедшие тайтлы, от новых к старым.
        </p>
      </div>

      <Suspense key={page} fallback={<CardGridSkeleton count={PAGE_SIZE} />}>
        <NewGrid page={page} />
      </Suspense>
    </div>
  );
}

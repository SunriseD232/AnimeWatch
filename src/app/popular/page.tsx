import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import ModeSwitch from '@/components/ModeSwitch';
import Pagination from '@/components/Pagination';
import { CardGridSkeleton } from '@/components/Skeletons';
import { getPopularRanked } from '@/lib/shikimori';

export const metadata = { title: 'Популярное — MediaWatch' };

const PAGE_SIZE = 24;

async function PopularGrid({ page }: { page: number }) {
  let data;
  try {
    data = await getPopularRanked(page, PAGE_SIZE);
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
        {page > 1
          ? 'Дальше ничего нет.'
          : 'В этом году пока нет тайтлов с рейтингом.'}
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

      <Pagination
        page={page}
        prevHref={hasPrev ? `/popular?page=${page - 1}` : null}
        nextHref={data.hasMore ? `/popular?page=${page + 1}` : null}
      />
    </div>
  );
}

export default function PopularPage({
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
        <h1 className="text-xl font-bold">Популярное</h1>
        <p className="text-sm text-gray-400">
          Топ по рейтингу среди тайтлов {new Date().getFullYear()} года.
        </p>
      </div>

      <Suspense key={page} fallback={<CardGridSkeleton count={PAGE_SIZE} />}>
        <PopularGrid page={page} />
      </Suspense>
    </div>
  );
}

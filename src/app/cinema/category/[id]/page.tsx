import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import CinemaCard from '@/components/CinemaCard';
import ModeSwitch from '@/components/ModeSwitch';
import { CardGridSkeleton } from '@/components/Skeletons';
import { CINEMA_CATEGORIES, getCinemaByCategory } from '@/lib/videoseed-catalog';

const PAGE_SIZE = 24;

export function generateMetadata({ params }: { params: { id: string } }) {
  const def = CINEMA_CATEGORIES.find((c) => c.id === params.id);
  return { title: `${def?.label ?? 'Категория'} — MediaWatch` };
}

async function CategoryGrid({
  categoryId,
  page,
}: {
  categoryId: string;
  page: number;
}) {
  let data;
  try {
    data = await getCinemaByCategory(categoryId, page, PAGE_SIZE);
  } catch {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Videoseed. Попробуйте обновить страницу
        позже.
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {page > 1 ? 'Дальше ничего нет.' : 'В этой категории пока нет тайтлов.'}
      </div>
    );
  }

  const hasPrev = page > 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((item) => (
          <CinemaCard key={item.id} item={item} />
        ))}
      </div>

      <div className="flex items-center justify-center gap-2">
        <Link
          href={hasPrev ? `/cinema/category/${categoryId}?page=${page - 1}` : '#'}
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
          href={data.hasMore ? `/cinema/category/${categoryId}?page=${page + 1}` : '#'}
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

export default function CinemaCategoryPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { page?: string };
}) {
  const def = CINEMA_CATEGORIES.find((c) => c.id === params.id);
  if (!def) notFound();

  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="cinema" />

      <div>
        <h1 className="text-xl font-bold">{def.label}</h1>
      </div>

      <Suspense key={page} fallback={<CardGridSkeleton count={PAGE_SIZE} />}>
        <CategoryGrid categoryId={def.id} page={page} />
      </Suspense>
    </div>
  );
}

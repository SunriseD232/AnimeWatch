import AnimeCard from '@/components/AnimeCard';
import Pagination from '@/components/Pagination';
import { getNewAnime } from '@/lib/shikimori';

export const metadata = { title: 'Новинки — MediaWatch' };

const PAGE_SIZE = 24;

export default async function NewAnimePage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

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

      <Pagination
        page={page}
        prevHref={hasPrev ? `/new?page=${page - 1}` : null}
        nextHref={data.hasMore ? `/new?page=${page + 1}` : null}
      />
    </div>
  );
}

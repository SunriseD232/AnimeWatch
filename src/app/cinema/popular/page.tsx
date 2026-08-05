import CinemaCard from '@/components/CinemaCard';
import Pagination from '@/components/Pagination';
import { getPopularCinemaRanked } from '@/lib/videoseed-catalog';

export const metadata = { title: 'Популярное — MediaWatch' };

const PAGE_SIZE = 24;

export default async function PopularCinemaPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  let data;
  try {
    data = await getPopularCinemaRanked(page, PAGE_SIZE);
  } catch {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог Videoseed. Попробуйте обновить страницу
        позже.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {page > 1 ? (
          'Дальше ничего нет.'
        ) : (
          <>
            Каталог кино недоступен. Убедитесь, что задан{' '}
            <code className="rounded bg-black/30 px-1">VIDEOSEED_API_TOKEN</code>.
          </>
        )}
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

      <Pagination
        page={page}
        prevHref={hasPrev ? `/cinema/popular?page=${page - 1}` : null}
        nextHref={data.hasMore ? `/cinema/popular?page=${page + 1}` : null}
      />
    </div>
  );
}

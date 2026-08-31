import CinemaCard from '@/components/CinemaCard';
import Pagination from '@/components/Pagination';
import {
  CINEMA_CATALOG_SORTS,
  CINEMA_GENRES,
  getCinemaCatalog,
  getCinemaEpisodesTotalMap,
  type CinemaCatalogSort,
} from '@/lib/videoseed-catalog';
import { getEpisodeProgressMap } from '@/lib/watch/progressMap';

export const metadata = { title: 'Каталог кино — MediaWatch' };

// Пул для сортировки/фильтра — до MAX_UPSTREAM_PAGES апстрим-страниц на
// редкую комбинацию жанров (см. lib/videoseed-catalog.ts).
export const maxDuration = 60;

const PAGE_SIZE = 24;
const DEFAULT_SORT: CinemaCatalogSort = 'new';

function parseGenres(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => CINEMA_GENRES.includes(v));
}

function isValidSort(value: string | undefined): value is CinemaCatalogSort {
  return CINEMA_CATALOG_SORTS.some((s) => s.value === value);
}

function pageHref(
  genresInclude: string[],
  genresExclude: string[],
  sort: CinemaCatalogSort,
  page: number,
): string {
  const params = new URLSearchParams();
  if (genresInclude.length > 0) params.set('genres', genresInclude.join(','));
  if (genresExclude.length > 0) params.set('exclude', genresExclude.join(','));
  if (sort !== DEFAULT_SORT) params.set('sort', sort);
  params.set('page', String(page));
  return `/cinema/catalog?${params.toString()}`;
}

export default async function CinemaCatalogPage({
  searchParams,
}: {
  searchParams: { genres?: string; exclude?: string; sort?: string; page?: string };
}) {
  const genresInclude = parseGenres(searchParams.genres);
  const genresExclude = parseGenres(searchParams.exclude);
  const sort = isValidSort(searchParams.sort) ? searchParams.sort : DEFAULT_SORT;
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  let data;
  try {
    data = await getCinemaCatalog({
      type: 'both',
      genresInclude,
      genresExclude,
      sort,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    console.error('[cinema/catalog] getCinemaCatalog упал:', err instanceof Error ? err.message : err);
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
        {page > 1
          ? 'Дальше ничего нет.'
          : 'По этим фильтрам ничего не нашлось. Попробуйте убрать часть жанров.'}
      </div>
    );
  }

  const hasPrev = page > 1;
  const progressMap = await getEpisodeProgressMap('cinema', data.items.map((item) => item.id));
  const episodesTotalMap = await getCinemaEpisodesTotalMap([...progressMap.keys()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((item) => (
          <CinemaCard
            key={item.id}
            item={item}
            currentEpisode={progressMap.get(item.id) ?? null}
            episodesTotal={episodesTotalMap.get(item.id) ?? null}
          />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={hasPrev ? pageHref(genresInclude, genresExclude, sort, page - 1) : null}
        nextHref={data.hasMore ? pageHref(genresInclude, genresExclude, sort, page + 1) : null}
      />
    </div>
  );
}

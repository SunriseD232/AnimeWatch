import AnimeCard from '@/components/AnimeCard';
import Pagination from '@/components/Pagination';
import { ANIME_CATALOG_SORTS, getAnimeCatalog, type AnimeCatalogSort } from '@/lib/shikimori';
import { getEpisodeProgressMap } from '@/lib/watch/progressMap';

export const metadata = { title: 'Каталог аниме — MediaWatch' };

// Медленный путь (AND/exclude по нескольким жанрам) может догружать десятки
// полных карточек — см. getAnimeCatalog в lib/shikimori.ts. 60 сек с запасом
// покрывает потолок MAX_CATALOG_CANDIDATES при троттлере 5 rps.
export const maxDuration = 60;

const PAGE_SIZE = 24;
const DEFAULT_SORT: AnimeCatalogSort = 'aired_on';

function parseIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function isValidSort(value: string | undefined): value is AnimeCatalogSort {
  return ANIME_CATALOG_SORTS.some((s) => s.value === value);
}

function pageHref(
  genresInclude: number[],
  genresExclude: number[],
  sort: AnimeCatalogSort,
  page: number,
  showAnons: boolean,
): string {
  const params = new URLSearchParams();
  if (genresInclude.length > 0) params.set('genres', genresInclude.join(','));
  if (genresExclude.length > 0) params.set('exclude', genresExclude.join(','));
  if (sort !== DEFAULT_SORT) params.set('sort', sort);
  if (showAnons) params.set('anons', '1');
  params.set('page', String(page));
  return `/catalog?${params.toString()}`;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: { genres?: string; exclude?: string; sort?: string; page?: string; anons?: string };
}) {
  const genresInclude = parseIds(searchParams.genres);
  const genresExclude = parseIds(searchParams.exclude);
  const sort = isValidSort(searchParams.sort) ? searchParams.sort : DEFAULT_SORT;
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const showAnons = searchParams.anons === '1';

  let data;
  try {
    data = await getAnimeCatalog({
      genresInclude,
      genresExclude,
      sort,
      page,
      pageSize: PAGE_SIZE,
      excludeAnons: !showAnons,
    });
  } catch (err) {
    console.error('[catalog] getAnimeCatalog упал:', err instanceof Error ? err.message : err);
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
          : 'По этим фильтрам ничего не нашлось. Попробуйте убрать часть жанров.'}
      </div>
    );
  }

  const hasPrev = page > 1;
  const progressMap = await getEpisodeProgressMap('anime', data.items.map((a) => a.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((a) => (
          <AnimeCard key={a.id} anime={a} currentEpisode={progressMap.get(a.id) ?? null} />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={hasPrev ? pageHref(genresInclude, genresExclude, sort, page - 1, showAnons) : null}
        nextHref={data.hasMore ? pageHref(genresInclude, genresExclude, sort, page + 1, showAnons) : null}
      />
    </div>
  );
}

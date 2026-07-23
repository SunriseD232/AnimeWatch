import Link from 'next/link';
import { Suspense } from 'react';
import CinemaCard from '@/components/CinemaCard';
import GenreFilterPanel from '@/components/GenreFilterPanel';
import ModeSwitch from '@/components/ModeSwitch';
import { CardGridSkeleton } from '@/components/Skeletons';
import {
  CINEMA_CATALOG_SORTS,
  CINEMA_GENRES,
  getCinemaCatalog,
  type CinemaCatalogSort,
} from '@/lib/videoseed-catalog';

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

async function CatalogGrid({
  genresInclude,
  genresExclude,
  sort,
  page,
}: {
  genresInclude: string[];
  genresExclude: string[];
  sort: CinemaCatalogSort;
  page: number;
}) {
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
        {page > 1
          ? 'Дальше ничего нет.'
          : 'По этим фильтрам ничего не нашлось. Попробуйте убрать часть жанров.'}
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
          href={
            hasPrev
              ? pageHref(genresInclude, genresExclude, sort, page - 1)
              : '#'
          }
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
          href={
            data.hasMore
              ? pageHref(genresInclude, genresExclude, sort, page + 1)
              : '#'
          }
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

export default function CinemaCatalogPage({
  searchParams,
}: {
  searchParams: { genres?: string; exclude?: string; sort?: string; page?: string };
}) {
  const genresInclude = parseGenres(searchParams.genres);
  const genresExclude = parseGenres(searchParams.exclude);
  const sort = isValidSort(searchParams.sort) ? searchParams.sort : DEFAULT_SORT;
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="cinema" />

      <div>
        <h1 className="text-xl font-bold">Каталог кино</h1>
        <p className="text-sm text-gray-400">
          Выбирайте жанры (клик — включить, ещё раз — исключить), сочетайте
          несколько сразу.
        </p>
      </div>

      <GenreFilterPanel
        genres={CINEMA_GENRES.map((g) => ({ value: g, label: g }))}
        sorts={[...CINEMA_CATALOG_SORTS]}
        defaultSort={DEFAULT_SORT}
      />

      <Suspense
        key={`${searchParams.genres ?? ''}|${searchParams.exclude ?? ''}|${sort}|${page}`}
        fallback={<CardGridSkeleton count={PAGE_SIZE} />}
      >
        <CatalogGrid
          genresInclude={genresInclude}
          genresExclude={genresExclude}
          sort={sort}
          page={page}
        />
      </Suspense>
    </div>
  );
}

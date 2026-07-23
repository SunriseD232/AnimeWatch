import Link from 'next/link';
import { Suspense } from 'react';
import AnimeCard from '@/components/AnimeCard';
import GenreFilterPanel from '@/components/GenreFilterPanel';
import ModeSwitch from '@/components/ModeSwitch';
import { CardGridSkeleton } from '@/components/Skeletons';
import {
  ANIME_CATALOG_SORTS,
  getAnimeCatalog,
  getAnimeGenres,
  type AnimeCatalogSort,
} from '@/lib/shikimori';

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
): string {
  const params = new URLSearchParams();
  if (genresInclude.length > 0) params.set('genres', genresInclude.join(','));
  if (genresExclude.length > 0) params.set('exclude', genresExclude.join(','));
  if (sort !== DEFAULT_SORT) params.set('sort', sort);
  params.set('page', String(page));
  return `/catalog?${params.toString()}`;
}

async function GenresPanel() {
  let genres: { id: number; russian: string }[] = [];
  try {
    genres = await getAnimeGenres();
  } catch {
    genres = [];
  }
  return (
    <GenreFilterPanel
      genres={genres.map((g) => ({ value: String(g.id), label: g.russian }))}
      sorts={[...ANIME_CATALOG_SORTS]}
      defaultSort={DEFAULT_SORT}
    />
  );
}

async function CatalogGrid({
  genresInclude,
  genresExclude,
  sort,
  page,
}: {
  genresInclude: number[];
  genresExclude: number[];
  sort: AnimeCatalogSort;
  page: number;
}) {
  let data;
  try {
    data = await getAnimeCatalog({
      genresInclude,
      genresExclude,
      sort,
      page,
      pageSize: PAGE_SIZE,
    });
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
          : 'По этим фильтрам ничего не нашлось. Попробуйте убрать часть жанров.'}
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

export default function CatalogPage({
  searchParams,
}: {
  searchParams: { genres?: string; exclude?: string; sort?: string; page?: string };
}) {
  const genresInclude = parseIds(searchParams.genres);
  const genresExclude = parseIds(searchParams.exclude);
  const sort = isValidSort(searchParams.sort) ? searchParams.sort : DEFAULT_SORT;
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="anime" />

      <div>
        <h1 className="text-xl font-bold">Каталог аниме</h1>
        <p className="text-sm text-gray-400">
          Выбирайте жанры (клик — включить, ещё раз — исключить), сочетайте
          несколько сразу.
        </p>
      </div>

      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}>
        <GenresPanel />
      </Suspense>

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

import Link from 'next/link';
import { Suspense } from 'react';
import CatalogFilterProvider from '@/components/catalog/CatalogFilterProvider';
import CatalogArea from '@/components/catalog/CatalogArea';
import CatalogToolbar from '@/components/catalog/CatalogToolbar';
import CatalogMobileDrawer from '@/components/catalog/CatalogMobileDrawer';
import CatalogMobileTrigger from '@/components/catalog/CatalogMobileTrigger';
import Pagination from '@/components/Pagination';
import BookCard from '@/components/books/BookCard';
import MangaCard from '@/components/manga/MangaCard';
import RanobeCard from '@/components/ranobe/RanobeCard';
import AudiobookCard from '@/components/audiobooks/AudiobookCard';
import { buildQuery, hasAnyFilter, parseFilters, type CatalogFilters } from '@/lib/catalogFilters';
import {
  READING_CATALOG_META,
  READING_FILTER_CONFIG,
  parseReadingSort,
  type ReadingKind,
  type ReadingSort,
} from '@/lib/readingFilters';
import {
  getAudiobookCatalogFiltered,
  getBookCatalogFiltered,
  getMangaCatalogFiltered,
  getRanobeCatalogFiltered,
  getReadingFacets,
} from '@/lib/readingCatalog';

/**
 * Каталоги чтения с фильтрами (/manga/catalog, /ranobe/catalog,
 * /books/catalog) — тот же каркас, что у кино (app/cinema/catalog): панель,
 * шторка на телефоне, кнопка «Применить» общие, отличается конфиг
 * (lib/readingFilters.ts) и запрос (lib/readingCatalog.ts).
 */

const PAGE_SIZE = 24;

async function Filters({ kind, children }: { kind: ReadingKind; children: React.ReactNode }) {
  // Справочники кэшируются на 6 часов (lib/readingCatalog.ts); нет индекса —
  // пустые списки, и панель просто не рисует эти группы.
  const options = await getReadingFacets(kind);
  const meta = READING_CATALOG_META[kind];

  return (
    <CatalogFilterProvider config={READING_FILTER_CONFIG[kind]}>
      <CatalogArea
        options={options}
        header={
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-3">
              <h1 className="text-xl font-bold">{meta.title}</h1>
              <Link href={meta.section} className="shrink-0 text-sm text-accent-text hover:underline">
                К разделу
              </Link>
            </div>
            <CatalogMobileTrigger />
          </div>
        }
        toolbar={<CatalogToolbar />}
      >
        {children}
      </CatalogArea>

      <CatalogMobileDrawer options={options} />
    </CatalogFilterProvider>
  );
}

export function ReadingCatalogLayout({ kind, children }: { kind: ReadingKind; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Suspense — из-за useSearchParams внутри провайдера: без него сборка
          падает на пререндере. Заодно закрывает и await за справочниками. */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}>
        <Filters kind={kind}>{children}</Filters>
      </Suspense>
    </div>
  );
}

/** searchParams страницы — обычный объект; фильтры разбирает общий код,
 *  которому нужен URLSearchParams. */
function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }
  return params;
}

function pageHref(kind: ReadingKind, filters: CatalogFilters, sort: ReadingSort, page: number): string {
  const qs = buildQuery(filters, READING_FILTER_CONFIG[kind], { sort, page });
  const path = READING_CATALOG_META[kind].path;
  return qs ? `${path}?${qs}` : path;
}

const GRID = 'catalog-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6';

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">{children}</div>
  );
}

export async function ReadingCatalogResults({
  kind,
  searchParams,
}: {
  kind: ReadingKind;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = toSearchParams(searchParams);
  const config = READING_FILTER_CONFIG[kind];
  const filters = parseFilters(params, config);
  const sort = parseReadingSort(kind, params.get('sort'));
  const pageParam = Number(params.get('page'));
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

  let cards: React.ReactNode[] | null = null;
  let hasMore = false;
  if (kind === 'manga') {
    const data = await getMangaCatalogFiltered(filters, sort, page, PAGE_SIZE);
    if (data) {
      hasMore = data.hasMore;
      cards = data.items.map((manga, i) => <MangaCard key={manga.id} manga={manga} priority={i < 6} />);
    }
  } else if (kind === 'ranobe') {
    const data = await getRanobeCatalogFiltered(filters, sort, page, PAGE_SIZE);
    if (data) {
      hasMore = data.hasMore;
      cards = data.items.map((ranobe, i) => <RanobeCard key={ranobe.id} ranobe={ranobe} priority={i < 6} />);
    }
  } else if (kind === 'audiobooks') {
    const data = await getAudiobookCatalogFiltered(filters, sort, page, PAGE_SIZE);
    if (data) {
      hasMore = data.hasMore;
      cards = data.items.map((audiobook, i) => (
        <AudiobookCard key={audiobook.id} audiobook={audiobook} priority={i < 6} />
      ));
    }
  } else {
    const data = await getBookCatalogFiltered(filters, sort, page, PAGE_SIZE);
    if (data) {
      hasMore = data.hasMore;
      cards = data.items.map((book, i) => <BookCard key={book.id} book={book} priority={i < 6} />);
    }
  }

  if (!cards) {
    return <Notice>Не удалось загрузить каталог. Попробуйте обновить страницу через минуту.</Notice>;
  }

  if (cards.length === 0) {
    return (
      <Notice>
        {page > 1
          ? 'Дальше ничего нет.'
          : hasAnyFilter(filters)
            ? 'По этим фильтрам ничего не нашлось. Попробуйте ослабить условия: убрать часть жанров или тегов, расширить диапазоны.'
            : 'Каталог ещё наполняется.'}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* .catalog-grid — при открытой панели фильтров карточки плавно мельчают
          вместе с колонкой, как у аниме и кино (см. globals.css). */}
      <div className={GRID}>{cards}</div>
      <Pagination
        page={page}
        prevHref={page > 1 ? pageHref(kind, filters, sort, page - 1) : null}
        nextHref={hasMore ? pageHref(kind, filters, sort, page + 1) : null}
      />
    </div>
  );
}

import { Suspense } from 'react';
import Link from 'next/link';
import Pagination from '@/components/Pagination';
import { CardGridSkeleton } from '@/components/Skeletons';
import MangaCard from '@/components/manga/MangaCard';
import MangaContinue from '@/components/manga/MangaContinue';
import MangaSearchBar from '@/components/manga/MangaSearchBar';
import {
  fetchMangaCatalogPage,
  getMangaCatalog,
  getMangaKinds,
  rememberManga,
  searchManga,
} from '@/lib/manga';
import type { MangaSummary } from '@/lib/mangaShared';

export const metadata = { title: 'Манга — MediaWatch' };

// Живой поиск и запасной каталог — запросы к Remanga (таймаут 20 сек, см.
// lib/manga.ts). Основной каталог читается из своего индекса одним SQL.
export const maxDuration = 30;

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

/**
 * Каталог манги.
 *
 * Два источника, как у книг и ранобэ:
 *   • свой индекс (manga_index, миграция 0056) — витрина без сети и поиск по
 *     подстроке триграммами;
 *   • живой API Remanga — поиск, а также запасной каталог, пока индекс ещё
 *     не собран (сразу после применения миграции).
 *
 * Всё, что нашлось живьём, «докладывается» в индекс, чтобы карточка
 * открылась по слагу, даже если тайтла нет в текущей витрине.
 */
export default async function MangaPage({
  searchParams,
}: {
  searchParams: { q?: string; kind?: string; page?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  const kind = (searchParams.kind ?? '').trim();
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const kinds = await getMangaKinds();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">Манга</h1>
        <p className="text-sm text-gray-400">
          Манга, манхва и маньхуа со всех регионов. Бесплатные главы читаются
          прямо на сайте — вертикальной лентой, с оглавлением и сохранением
          места. Платные главы источника отмечены, но их страницы недоступны без
          покупки.
        </p>
      </div>

      <MangaSearchBar initialQuery={query} initialKind={kind} />

      {kinds.length > 0 ? (
        <KindChips kinds={kinds.slice(0, 10)} active={kind} />
      ) : null}

      <Suspense fallback={null}>
        <MangaContinue />
      </Suspense>

      <Suspense key={`${query}:${kind}:${page}`} fallback={<CardGridSkeleton count={12} />}>
        <MangaResults query={query} kind={kind} page={page} />
      </Suspense>
    </div>
  );
}

async function MangaResults({
  query,
  kind,
  page,
}: {
  query: string;
  kind: string;
  page: number;
}) {
  // Запрос есть — живой поиск (+ индекс на первой странице, чтобы
  // подстрочные совпадения из витрины не терялись).
  if (query) {
    const [live, indexed] = await Promise.all([
      searchManga(query, page),
      page === 1
        ? getMangaCatalog({ query, page: 1, pageSize: PAGE_SIZE })
        : Promise.resolve({ items: [], total: 0 }),
    ]);

    if (live.items.length > 0) await rememberManga(live.items);
    const liveItems = kind
      ? live.items.filter((manga) => manga.kind === kind)
      : live.items;
    const items = mergeManga(indexed.items, liveItems);

    return (
      <ResultsGrid
        items={items}
        page={page}
        hasMore={live.hasNext}
        hrefForPage={(p) => pageHref({ query, kind, page: p })}
        emptyText="По этому запросу ничего не нашлось. Попробуйте другое название — Remanga ищет и по оригинальному имени."
      />
    );
  }

  // Запроса нет — витрина индекса. Если она пуста (миграция применена, а крон
  // ещё не прогнан), показываем живой каталог источником и «докладываем» его.
  const indexed = await getMangaCatalog({ kind, page, pageSize: PAGE_SIZE });

  if (indexed.total > 0) {
    return (
      <ResultsGrid
        items={indexed.items}
        page={page}
        hasMore={indexed.total > page * PAGE_SIZE}
        hrefForPage={(p) => pageHref({ query, kind, page: p })}
        emptyText="Каталог манги ещё наполняется."
      />
    );
  }

  // Индекс пуст (миграция применена, крон ещё не прогнан) — показываем живой
  // каталог источником. Фильтр по типу применяем здесь же: иначе выбранный
  // чип «Манхва» выглядел бы сломанным до первой пересборки витрины.
  const live = await fetchMangaCatalogPage({
    ordering: '-views',
    page,
    count: PAGE_SIZE,
  });
  if (live.items.length > 0) await rememberManga(live.items);
  const items = kind
    ? live.items.filter((manga) => manga.kind === kind)
    : live.items;

  return (
    <ResultsGrid
      items={items}
      page={page}
      hasMore={live.totalPages > page}
      hrefForPage={(p) => pageHref({ query, kind, page: p })}
      emptyText={
        kind
          ? `Среди популярной манги типа «${kind}» пока ничего нет. Витрина ещё наполняется.`
          : 'Каталог манги ещё наполняется. Введите название в поиске — живой поиск по Remanga работает уже сейчас.'
      }
    />
  );
}

function ResultsGrid({
  items,
  page,
  hasMore,
  hrefForPage,
  emptyText,
}: {
  items: MangaSummary[];
  page: number;
  hasMore: boolean;
  hrefForPage: (page: number) => string;
  emptyText: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="catalog-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((manga, i) => (
          <MangaCard key={manga.id} manga={manga} priority={i < 6} />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={page > 1 ? hrefForPage(page - 1) : null}
        nextHref={hasMore ? hrefForPage(page + 1) : null}
      />
    </div>
  );
}

/** Слияние витрины и живой выдачи: индекс первым, живое — в конец. */
function mergeManga(
  indexed: MangaSummary[],
  live: MangaSummary[],
): MangaSummary[] {
  if (live.length === 0) return indexed;
  const seen = new Set(indexed.map((m) => m.id));
  return [...indexed, ...live.filter((m) => !seen.has(m.id))];
}

function pageHref({
  query,
  kind,
  page,
}: {
  query: string;
  kind: string;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (kind) params.set('kind', kind);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/manga?${qs}` : '/manga';
}

/** Типы витрины — горизонтальная лента чипов. */
function KindChips({
  kinds,
  active,
}: {
  kinds: { kind: string; count: number }[];
  active: string;
}) {
  return (
    <div className="-mx-1 flex flex-wrap gap-2">
      {/* prefetch={false} у всех чипов: они видны сразу, и Next заранее
          рендерил на сервере каждую их страницу — десятки тяжёлых запросов
          каталога на одно открытие раздела. 24.10.2026 это забивало базу так,
          что Supabase Auth не успевал ответить и разделы «не открывались». */}
      <Link
        prefetch={false}
        href="/manga"
        aria-current={!active ? 'page' : undefined}
        className={[
          'press rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition',
          active
            ? 'bg-bg-card text-gray-200 ring-white/10 hover:text-white'
            : 'bg-accent/15 text-accent-text ring-accent/30',
        ].join(' ')}
      >
        Все
      </Link>
      {kinds.map(({ kind, count }) => (
        <Link
          prefetch={false}
          key={kind}
          href={`/manga?kind=${encodeURIComponent(kind)}`}
          aria-current={kind === active ? 'page' : undefined}
          className={[
            'press rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition',
            kind === active
              ? 'bg-accent/15 text-accent-text ring-accent/30'
              : 'bg-bg-card text-gray-300 ring-white/10 hover:text-white',
          ].join(' ')}
        >
          {kind}
          <span className="ml-1 text-gray-500">{count}</span>
        </Link>
      ))}
    </div>
  );
}

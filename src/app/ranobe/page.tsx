import { Suspense } from 'react';
import Link from 'next/link';
import Pagination from '@/components/Pagination';
import { CardGridSkeleton } from '@/components/Skeletons';
import RanobeCard from '@/components/ranobe/RanobeCard';
import RanobeContinue from '@/components/ranobe/RanobeContinue';
import RanobeSearchBar from '@/components/ranobe/RanobeSearchBar';
import {
  fetchRanobeCatalogPage,
  getRanobeCatalog,
  getRanobeKinds,
  rememberRanobe,
  searchRanobe,
} from '@/lib/ranobe';
import type { RanobeSummary } from '@/lib/ranobeShared';

export const metadata = { title: 'Ранобэ — MediaWatch' };

// Живой поиск и запасной каталог — запросы к Renovels (таймаут 20 сек, см.
// lib/ranobe.ts). Основной каталог читается из своего индекса одним SQL.
export const maxDuration = 30;

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

/**
 * Каталог ранобэ.
 *
 * Два источника, как у книг:
 *   • свой индекс (ranobe_index, миграция 0055) — витрина без сети и поиск по
 *     подстроке триграммами;
 *   • живой API Renovels — поиск, а также запасной каталог, пока индекс ещё
 *     не собран (сразу после применения миграции).
 *
 * Всё, что нашлось живьём, «докладывается» в индекс, чтобы карточка
 * открылась по слагу, даже если тайтла нет в текущей витрине.
 */
export default async function RanobePage({
  searchParams,
}: {
  searchParams: { q?: string; kind?: string; page?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  const kind = (searchParams.kind ?? '').trim();
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const kinds = await getRanobeKinds();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">Ранобэ</h1>
        <p className="text-sm text-gray-400">
          Корейские, китайские, японские и авторские романы. Читать можно прямо на сайте —
          с оглавлением, тёмной темой и сохранением места. Платные главы источника отмечены,
          но их текст недоступен без покупки.
        </p>
      </div>

      <RanobeSearchBar initialQuery={query} initialKind={kind} />

      {kinds.length > 0 ? (
        <KindChips kinds={kinds.slice(0, 10)} active={kind} />
      ) : null}

      <Suspense fallback={null}>
        <RanobeContinue />
      </Suspense>

      <Suspense key={`${query}:${kind}:${page}`} fallback={<CardGridSkeleton count={12} />}>
        <RanobeResults query={query} kind={kind} page={page} />
      </Suspense>
    </div>
  );
}

async function RanobeResults({
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
      searchRanobe(query, page),
      page === 1
        ? getRanobeCatalog({ query, page: 1, pageSize: PAGE_SIZE })
        : Promise.resolve({ items: [], total: 0 }),
    ]);

    if (live.items.length > 0) await rememberRanobe(live.items);
    const liveItems = kind
      ? live.items.filter((ranobe) => ranobe.kind === kind)
      : live.items;
    const items = mergeRanobe(indexed.items, liveItems);

    return (
      <ResultsGrid
        items={items}
        page={page}
        hasMore={live.hasNext}
        hrefForPage={(p) => pageHref({ query, kind, page: p })}
        emptyText="По этому запросу ничего не нашлось. Попробуйте другое название — Renovels ищет и по оригинальному имени."
      />
    );
  }

  // Запроса нет — витрина индекса. Если она пуста (миграция применена, а крон
  // ещё не прогнан), показываем живой каталог источником и «докладываем» его.
  const indexed = await getRanobeCatalog({ kind, page, pageSize: PAGE_SIZE });

  if (indexed.total > 0) {
    return (
      <ResultsGrid
        items={indexed.items}
        page={page}
        hasMore={indexed.total > page * PAGE_SIZE}
        hrefForPage={(p) => pageHref({ query, kind, page: p })}
        emptyText="Каталог ранобэ ещё наполняется."
      />
    );
  }

  // Индекс пуст (миграция применена, крон ещё не прогнан) — показываем живой
  // каталог источником. Фильтр по типу применяем здесь же: иначе выбранный
  // чип «Корея» выглядел бы сломанным до первой пересборки витрины.
  const live = await fetchRanobeCatalogPage({
    ordering: '-views',
    page,
    count: PAGE_SIZE,
  });
  if (live.items.length > 0) await rememberRanobe(live.items);
  const items = kind
    ? live.items.filter((ranobe) => ranobe.kind === kind)
    : live.items;

  return (
    <ResultsGrid
      items={items}
      page={page}
      hasMore={live.totalPages > page}
      hrefForPage={(p) => pageHref({ query, kind, page: p })}
      emptyText={
        kind
          ? `Среди популярных ранобэ типа «${kind}» пока ничего нет. Витрина ещё наполняется.`
          : 'Каталог ранобэ ещё наполняется. Введите название в поиске — живой поиск по Renovels работает уже сейчас.'
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
  items: RanobeSummary[];
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
        {items.map((ranobe, i) => (
          <RanobeCard key={ranobe.id} ranobe={ranobe} priority={i < 6} />
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
function mergeRanobe(
  indexed: RanobeSummary[],
  live: RanobeSummary[],
): RanobeSummary[] {
  if (live.length === 0) return indexed;
  const seen = new Set(indexed.map((r) => r.id));
  return [...indexed, ...live.filter((r) => !seen.has(r.id))];
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
  return qs ? `/ranobe?${qs}` : '/ranobe';
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
      <Link
        href="/ranobe"
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
          key={kind}
          href={`/ranobe?kind=${encodeURIComponent(kind)}`}
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

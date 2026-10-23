import { cookies } from 'next/headers';
import { Suspense } from 'react';
import Pagination from '@/components/Pagination';
import { CardGridSkeleton } from '@/components/Skeletons';
import PodcastCard from '@/components/podcasts/PodcastCard';
import PodcastContinue from '@/components/podcasts/PodcastContinue';
import PodcastSearchBar from '@/components/podcasts/PodcastSearchBar';
import {
  DEFAULT_PODCAST_REGION,
  PODCAST_REGION_COOKIE,
  getPodcastCatalog,
  normalizeRegion,
  searchPodcastsLive,
  type PodcastRegion,
  type PodcastSummary,
} from '@/lib/podcasts';

export const metadata = { title: 'Подкасты — MediaWatch' };

// Живой поиск бьёт по iTunes параллельно по выбранному региону, у каждого
// запроса свой таймаут 15 сек (см. lib/podcasts.ts). Каталог из индекса —
// один SQL-запрос. Максимум тут — путь без индекса с одним регионом.
export const maxDuration = 30;

const PAGE_SIZE = 24;

/**
 * Каталог подкастов.
 *
 * Как и у аниме/кино, основной путь — свой индекс (podcast_index, миграция
 * 0052): один триграммный SQL-запрос вместо сетевых вызовов, поэтому
 * «реализация ии» находит совпадение по подстроке в названии и авторе.
 *
 * Но у подкастов есть отличие от аниме и кино, из-за которого свой индекс
 * НЕ единственный источник. Каталогов подкастов много и они появляются
 * ежедневно; между суточными прогонами крона в индексе запросто нет шоу,
 * о котором человек только что услышал. Поэтому при поиске с запросом мы
 * дополнительно спрашиваем iTunes живьём по выбранному региону и
 * показываем объединение (индекс + живая выдача), дедуплицируя по id. Когда
 * запроса нет, живого поиска нет и не нужно — там показываем каталог.
 *
 * Регион — параметр адреса (пересылается ссылкой), с откатом на куку: он
 * обязателен для живого поиска в iTunes (там country обязателен), а для
 * индекса — фильтр по country.
 */
export default async function PodcastsPage({
  searchParams,
}: {
  searchParams: { q?: string; region?: string; page?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  const cookieRegion = normalizeRegion(cookies().get(PODCAST_REGION_COOKIE)?.value);
  const region: PodcastRegion =
    normalizeRegion(searchParams.region) ?? cookieRegion ?? DEFAULT_PODCAST_REGION;
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">Подкасты</h1>
        <p className="text-sm text-gray-400">
          Поиск по названию или автору. Регион влияет и на живой поиск в iTunes, и на фильтр
          каталога.
        </p>
      </div>

      <PodcastSearchBar initialQuery={query} initialRegion={region} />

      <Suspense fallback={null}>
        <PodcastContinue />
      </Suspense>

      <Suspense key={`${query}:${region}:${page}`} fallback={<CardGridSkeleton count={12} />}>
        <PodcastResults query={query} region={region} page={page} />
      </Suspense>
    </div>
  );
}

async function PodcastResults({
  query,
  region,
  page,
}: {
  query: string;
  region: PodcastRegion;
  page: number;
}) {
  // Индекс — основной путь. Живой поиск добавляем только когда есть запрос
  // (см. комментарий выше) и только на первой странице: у живого поиска нет
  // пагинации, показывать одну и ту же живую выдачу на каждой странице было
  // бы враньём.
  const [catalog, live] = await Promise.all([
    getPodcastCatalog({ query, region, page, pageSize: PAGE_SIZE }),
    query && page === 1 ? searchPodcastsLive(query, [region], 25) : Promise.resolve([]),
  ]);

  const items = mergeSummaries(catalog.items, live);
  const hasMore = catalog.total > page * PAGE_SIZE;

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {query
          ? 'По этому запросу ничего не нашлось. Попробуйте сформулировать иначе или сменить регион.'
          : 'Каталог подкастов ещё наполняется. Введите название в поиске — живой поиск по iTunes работает уже сейчас.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="catalog-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((p, i) => (
          <PodcastCard key={p.id} podcast={p} priority={i < 6} />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={page > 1 ? pageHref(query, region, page - 1) : null}
        nextHref={hasMore ? pageHref(query, region, page + 1) : null}
      />
    </div>
  );
}

/**
 * Слияние выдачи индекса и живой выдачи iTunes. Индекс — первым (он уже
 * отфильтрован по региону), живое — в конец. Дедуп по collectionId: одно и
 * то же шоу почти всегда окажется и там, и там.
 */
function mergeSummaries(index: PodcastSummary[], live: PodcastSummary[]): PodcastSummary[] {
  if (live.length === 0) return index;
  const seen = new Set(index.map((p) => p.id));
  return [...index, ...live.filter((p) => !seen.has(p.id))];
}

function pageHref(query: string, region: PodcastRegion, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (region !== DEFAULT_PODCAST_REGION) params.set('region', region);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/podcasts?${qs}` : '/podcasts';
}

import AnimeCard from '@/components/AnimeCard';
import Pagination from '@/components/Pagination';
import { ANIME_CATALOG_SORTS, getAnimeCatalog, type AnimeCatalogSort } from '@/lib/shikimori';
import { getEpisodeProgressMap } from '@/lib/watch/progressMap';
import { getAnimeCatalogFromIndex } from '@/lib/animeIndexQuery';
import {
  PARAM,
  buildQuery,
  hasAnyFilter,
  parseFilters,
  parseNumericIds,
  type AnimeCatalogFilters,
} from '@/lib/animeFilters';

export const metadata = { title: 'Каталог аниме — MediaWatch' };

// Медленный путь (AND/exclude по нескольким жанрам) может догружать десятки
// полных карточек — см. getAnimeCatalog в lib/shikimori.ts. 60 сек с запасом
// покрывает потолок MAX_CATALOG_CANDIDATES при троттлере 5 rps.
export const maxDuration = 60;

const PAGE_SIZE = 24;
const DEFAULT_SORT: AnimeCatalogSort = 'aired_on';

function isValidSort(value: string | undefined): value is AnimeCatalogSort {
  return ANIME_CATALOG_SORTS.some((s) => s.value === value);
}

/** searchParams у страницы — обычный объект; фильтры разбираются общим
 *  кодом с клиентом (lib/animeFilters.ts), которому нужен URLSearchParams. */
function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }
  return params;
}

function pageHref(
  filters: AnimeCatalogFilters,
  sort: AnimeCatalogSort,
  page: number,
  showAnons: boolean,
): string {
  const qs = buildQuery(filters, { sort, defaultSort: DEFAULT_SORT, page, showAnons });
  return qs ? `/catalog?${qs}` : '/catalog';
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = toSearchParams(searchParams);
  const filters = parseFilters(params);

  const sort = isValidSort(params.get(PARAM.sort) ?? undefined)
    ? (params.get(PARAM.sort) as AnimeCatalogSort)
    : DEFAULT_SORT;
  const pageParam = Number(params.get(PARAM.page));
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const showAnons = params.get(PARAM.anons) === '1';

  const catalogParams = {
    genresInclude: parseNumericIds(filters.genres.include.join(',')),
    genresExclude: parseNumericIds(filters.genres.exclude.join(',')),
    sort,
    page,
    pageSize: PAGE_SIZE,
    excludeAnons: !showAnons,
    episodesFrom: filters.episodesFrom,
    episodesTo: filters.episodesTo,
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    ratings: filters.ratings,
    kinds: filters.kinds,
    statuses: filters.statuses,
  };

  let data;
  try {
    // Сначала локальный индекс (см. lib/animeIndexQuery.ts) — там весь фильтр
    // это один SQL-запрос. Вернул null (индекс ещё не построен ночным кроном
    // или почему-то опустел) — работаем по-старому через Shikimori, чтобы
    // каталог не оставался пустым.
    data = (await getAnimeCatalogFromIndex(catalogParams)) ?? (await getAnimeCatalog(catalogParams));
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
          : hasAnyFilter(filters)
            ? 'По этим фильтрам ничего не нашлось. Попробуйте ослабить условия — например, расширить диапазон серий или года.'
            : 'Ничего не нашлось.'}
      </div>
    );
  }

  const hasPrev = page > 1;
  const progressMap = await getEpisodeProgressMap('anime', data.items.map((a) => a.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="catalog-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((a) => (
          <AnimeCard key={a.id} anime={a} currentEpisode={progressMap.get(a.id) ?? null} />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={hasPrev ? pageHref(filters, sort, page - 1, showAnons) : null}
        nextHref={data.hasMore ? pageHref(filters, sort, page + 1, showAnons) : null}
      />
    </div>
  );
}

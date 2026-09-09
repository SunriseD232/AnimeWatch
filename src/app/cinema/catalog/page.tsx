import CinemaCard from '@/components/CinemaCard';
import AnimeListRow from '@/components/catalog/AnimeListRow';
import Pagination from '@/components/Pagination';
import { getCinemaCatalog, getCinemaEpisodesTotalMap } from '@/lib/videoseed-catalog';
import { getEpisodeProgressMap } from '@/lib/watch/progressMap';
import { getCinemaCatalogFromIndex } from '@/lib/cinemaIndexQuery';
import {
  CINEMA_FILTER_CONFIG,
  CINEMA_PARAM,
  parseCinemaSort,
} from '@/lib/cinemaFilters';
import {
  COMMON_PARAM,
  buildQuery,
  hasAnyFilter,
  parseFilters,
  parseView,
  triIds,
  triValues,
  type CatalogFilters,
  type CatalogView,
} from '@/lib/catalogFilters';

export const metadata = { title: 'Каталог кино — MediaWatch' };

// Запасной путь (без индекса) может тянуть до 30 апстрим-страниц Videoseed,
// см. lib/videoseed-catalog.ts. Через индекс это один SQL-запрос.
export const maxDuration = 60;

const PAGE_SIZE = 24;

/** searchParams у страницы — обычный объект; фильтры разбираются общим
 *  кодом с клиентом (lib/catalogFilters.ts), которому нужен URLSearchParams. */
function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }
  return params;
}

function pageHref(
  filters: CatalogFilters,
  sort: string,
  page: number,
  view: CatalogView,
): string {
  const qs = buildQuery(filters, CINEMA_FILTER_CONFIG, { sort, page, view });
  return qs ? `/cinema/catalog?${qs}` : '/cinema/catalog';
}

export default async function CinemaCatalogPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = toSearchParams(searchParams);
  const filters = parseFilters(params, CINEMA_FILTER_CONFIG);
  const sort = parseCinemaSort(params.get(CINEMA_PARAM.sort));
  const pageParam = Number(params.get(CINEMA_PARAM.page));
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const view = parseView(params.get(COMMON_PARAM.view));

  const genres = triIds(filters, 'genres');
  const countries = triIds(filters, 'countries');
  const filtered = hasAnyFilter(filters);

  let data = await getCinemaCatalogFromIndex({
    genresInclude: genres.include,
    genresExclude: genres.exclude,
    countriesInclude: countries.include,
    countriesExclude: countries.exclude,
    kinds: triValues(filters, 'kinds'),
    yearFrom: filters.range.yearFrom,
    yearTo: filters.range.yearTo,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  // Индекса нет (первый запуск, не отработал крон, отвалился Supabase).
  // Запасной путь — прежний прямой запрос к Videoseed, но он умеет ровно две
  // сортировки и фильтр по названиям жанров, а не по id. Поэтому подменяем
  // его ТОЛЬКО когда фильтров нет: показать «отфильтровано» то, что на самом
  // деле не отфильтровано, хуже, чем честно сказать про недоступность.
  let degraded = false;
  if (!data && !filtered) {
    try {
      data = await getCinemaCatalog({
        type: 'both',
        genresInclude: [],
        genresExclude: [],
        sort: sort === 'rating' ? 'rating' : 'new',
        page,
        pageSize: PAGE_SIZE,
      });
    } catch (err) {
      console.error(
        '[cinema/catalog] запасной путь тоже упал:',
        err instanceof Error ? err.message : err,
      );
    }
  } else if (!data) {
    degraded = true;
  }

  if (degraded) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Каталог сейчас недоступен вместе с фильтрами — идёт обновление базы.
        Попробуйте обновить страницу через несколько минут.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        Не удалось загрузить каталог. Попробуйте обновить страницу позже.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {page > 1
          ? 'Дальше ничего нет.'
          : filtered
            ? 'По этим фильтрам ничего не нашлось. Попробуйте ослабить условия — например, расширить диапазон лет или убрать часть жанров.'
            : 'Ничего не нашлось.'}
      </div>
    );
  }

  const progressMap = await getEpisodeProgressMap(
    'cinema',
    data.items.map((item) => item.id),
  );
  const episodesTotalMap = await getCinemaEpisodesTotalMap([...progressMap.keys()]);

  return (
    <div className="flex flex-col gap-6">
      {view === 'list' ? (
        // Тот же компонент строки, что у аниме: отличаются только подписи в
        // строке характеристик и куда ведёт ссылка.
        <div className="flex flex-col gap-3">
          {data.items.map((item) => (
            <AnimeListRow
              key={item.id}
              anime={{
                id: item.id,
                href: `/cinema/${item.id}`,
                title: item.title,
                poster: item.poster,
                posterFallback: item.posterFallback ?? null,
                kindLabel: item.kind,
                // Статуса у кино нет как понятия: Videoseed не сообщает,
                // идёт сериал или закончился (см. lib/videoseed-catalog.ts).
                statusLabel: null,
                year: item.year,
                episodesLabel: null,
                score: item.rating !== null ? item.rating.toFixed(1) : null,
                description: item.description ?? null,
              }}
            />
          ))}
        </div>
      ) : (
        /* .catalog-grid — то же, что у аниме: при открытой панели фильтров
           карточки плавно мельчают вместе с колонкой (см. globals.css). */
        <div className="catalog-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.items.map((item) => (
            <CinemaCard
              key={item.id}
              item={item}
              currentEpisode={progressMap.get(item.id) ?? null}
              episodesTotal={episodesTotalMap.get(item.id) ?? null}
            />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        prevHref={page > 1 ? pageHref(filters, sort, page - 1, view) : null}
        nextHref={data.hasMore ? pageHref(filters, sort, page + 1, view) : null}
      />
    </div>
  );
}

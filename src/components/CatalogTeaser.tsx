import DiscoverTabs from '@/components/DiscoverTabs';
import RecommendedCarousel from '@/components/RecommendedCarousel';
import { getAnimeCatalogFromIndex } from '@/lib/animeIndexQuery';
import { getCinemaCatalogFromIndex } from '@/lib/cinemaIndexQuery';
import { EMPTY_TRI } from '@/lib/catalogFilters';
import type { ContentType } from '@/lib/types';

const TEASER_SIZE = 12;

/**
 * Тизер «Новинки/Популярное» на главной (см. план редизайна) — заменяет
 * прежнюю полную пагинируемую сетку. Ссылка «Весь каталог» (см.
 * DiscoverTabs) ведёт на /catalog или /cinema/catalog — там же полный набор
 * фильтров, дублировать его здесь незачем.
 *
 * Источник — ТОЛЬКО локальный индекс (anime_index/cinema_index), не живой
 * Shikimori/Videoseed: тизер рендерится на каждый заход на главную, и жечь
 * квоту чужого API на нём не стоит (та же логика, что у getAnimeIndexByIds).
 * Индекса нет (крон ещё не прогонялся) — секция просто не рендерится, без
 * отдельного отката на апстрим: тизер необязателен для работы сайта.
 */
export default async function CatalogTeaser({
  contentType,
  tab,
}: {
  contentType: ContentType;
  tab: string;
}) {
  const basePath = contentType === 'anime' ? '/' : '/cinema';
  const catalogHref = contentType === 'anime' ? '/catalog' : '/cinema/catalog';
  const activeKey = tab === 'popular' ? 'popular' : 'new';
  const tabs = [
    { key: 'new', label: 'Новинки', href: `${basePath}?tab=new` },
    { key: 'popular', label: 'Популярное', href: `${basePath}?tab=popular` },
  ];

  let body: React.ReactNode = null;
  if (contentType === 'anime') {
    const page = await getAnimeCatalogFromIndex({
      genresInclude: [],
      genresExclude: [],
      sort: activeKey === 'popular' ? 'popularity' : 'aired_on',
      page: 1,
      pageSize: TEASER_SIZE,
      excludeAnons: true,
    });
    if (page && page.items.length > 0) body = <RecommendedCarousel contentType="anime" items={page.items} />;
  } else {
    const page = await getCinemaCatalogFromIndex({
      genresInclude: [],
      genresExclude: [],
      countriesInclude: [],
      countriesExclude: [],
      kinds: EMPTY_TRI,
      yearFrom: null,
      yearTo: null,
      sort: activeKey === 'popular' ? 'popularity' : 'new',
      page: 1,
      pageSize: TEASER_SIZE,
    });
    if (page && page.items.length > 0) body = <RecommendedCarousel contentType="cinema" items={page.items} />;
  }

  if (!body) return null;

  return (
    <section className="flex flex-col gap-4">
      <DiscoverTabs tabs={tabs} activeKey={activeKey} catalogHref={catalogHref} />
      {body}
    </section>
  );
}

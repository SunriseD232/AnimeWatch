import RecommendedCarousel from '@/components/RecommendedCarousel';
import TeaserTabs from '@/components/TeaserTabs';
import { getAnimeCatalogFromIndex } from '@/lib/animeIndexQuery';
import { getCinemaCatalogFromIndex } from '@/lib/cinemaIndexQuery';
import { EMPTY_TRI } from '@/lib/catalogFilters';
import type { ContentType } from '@/lib/types';

/** Два ряда по двенадцать: на широком экране в ряд помещается шесть карточек,
 *  так что за краем остаётся примерно столько же, сколько видно — лента явно
 *  длиннее экрана, но не бесконечная. */
const TEASER_SIZE = 24;

/**
 * Тизер «Новинки / Популярное» на главной (см. план редизайна) — заменяет
 * прежнюю полную пагинируемую сетку. Ссылка «Весь каталог» ведёт на /catalog
 * или /cinema/catalog с той же сортировкой, что у открытой вкладки — там же
 * полный набор фильтров, дублировать его здесь незачем.
 *
 * Лента идёт В ДВА РЯДА: одного ряда на двенадцать карточек не хватало,
 * половина списка оставалась за правым краем экрана, хотя места по вертикали
 * было вдоволь.
 *
 * Обе ленты грузятся сразу, а вкладка показывает уже готовую (см.
 * TeaserTabs) — это два запроса к СВОЕМУ индексу, идущих параллельно.
 *
 * Источник — ТОЛЬКО локальный индекс (anime_index/cinema_index), не живой
 * Shikimori/Videoseed: тизер рендерится на каждый заход на главную, и жечь
 * квоту чужого API на нём не стоит. Индекса нет (крон ещё не прогонялся) —
 * секция просто не рендерится, без отката на апстрим: тизер необязателен.
 */
export default async function CatalogTeaser({ contentType }: { contentType: ContentType }) {
  const [fresh, popular] = await Promise.all([
    loadRow(contentType, 'new'),
    loadRow(contentType, 'popular'),
  ]);

  if (!fresh && !popular) return null;

  return (
    <TeaserTabs
      catalogHref={contentType === 'anime' ? '/catalog' : '/cinema/catalog'}
      sortParam={{
        fresh: contentType === 'anime' ? 'aired_on' : 'new',
        popular: 'popularity',
      }}
      fresh={fresh}
      popular={popular}
    />
  );
}

/** Лента одной вкладки или null, если индекс пуст либо недоступен. */
async function loadRow(
  contentType: ContentType,
  kind: 'new' | 'popular',
): Promise<React.ReactNode | null> {
  if (contentType === 'anime') {
    const page = await getAnimeCatalogFromIndex({
      genresInclude: [],
      genresExclude: [],
      sort: kind === 'popular' ? 'popularity' : 'aired_on',
      page: 1,
      pageSize: TEASER_SIZE,
      excludeAnons: true,
    });
    if (!page || page.items.length === 0) return null;
    return <RecommendedCarousel contentType="anime" items={page.items} rows={2} />;
  }

  const page = await getCinemaCatalogFromIndex({
    genresInclude: [],
    genresExclude: [],
    countriesInclude: [],
    countriesExclude: [],
    kinds: EMPTY_TRI,
    yearFrom: null,
    yearTo: null,
    sort: kind === 'popular' ? 'popularity' : 'new',
    page: 1,
    pageSize: TEASER_SIZE,
  });
  if (!page || page.items.length === 0) return null;
  return <RecommendedCarousel contentType="cinema" items={page.items} rows={2} />;
}

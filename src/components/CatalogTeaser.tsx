import Link from 'next/link';
import RecommendedCarousel from '@/components/RecommendedCarousel';
import { getAnimeCatalogFromIndex } from '@/lib/animeIndexQuery';
import { getCinemaCatalogFromIndex } from '@/lib/cinemaIndexQuery';
import { EMPTY_TRI } from '@/lib/catalogFilters';
import type { ContentType } from '@/lib/types';

const TEASER_SIZE = 12;

/**
 * Тизер главной: ДВА ряда — «Новинки» и «Популярное» — заменяет прежнюю
 * полную пагинируемую сетку.
 *
 * Раньше это был один ряд с вкладками: «Популярное» открывалось ссылкой
 * `?tab=popular`, то есть переходом с перерисовкой страницы, и два самых
 * ходовых списка нельзя было увидеть одновременно. Теперь оба видны сразу, а
 * вкладки не нужны вовсе — параметр ?tab= остался только для старых ссылок
 * (см. редирект в page.tsx).
 *
 * Источник — ТОЛЬКО локальный индекс (anime_index/cinema_index), не живой
 * Shikimori/Videoseed: тизер рендерится на каждый заход на главную, и жечь
 * квоту чужого API на нём не стоит. Индекса нет (крон ещё не прогонялся) —
 * ряд просто не рендерится, без отдельного отката на апстрим: тизер
 * необязателен для работы сайта.
 */
export default async function CatalogTeaser({ contentType }: { contentType: ContentType }) {
  const catalogHref = contentType === 'anime' ? '/catalog' : '/cinema/catalog';

  const [fresh, popular] = await Promise.all([
    loadRow(contentType, 'new'),
    loadRow(contentType, 'popular'),
  ]);

  if (!fresh && !popular) return null;

  return (
    <div className="flex flex-col gap-10">
      {fresh && (
        <TeaserRow
          title="Новинки"
          catalogHref={`${catalogHref}?sort=${contentType === 'anime' ? 'aired_on' : 'new'}`}
        >
          {fresh}
        </TeaserRow>
      )}
      {popular && (
        <TeaserRow title="Популярное" catalogHref={`${catalogHref}?sort=popularity`}>
          {popular}
        </TeaserRow>
      )}
    </div>
  );
}

/** Один ряд: заголовок, ссылка в каталог с той же сортировкой, карусель. */
function TeaserRow({
  title,
  catalogHref,
  children,
}: {
  title: string;
  catalogHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{title}</h2>
        {/* Ссылка ведёт в каталог УЖЕ С ЭТОЙ сортировкой: раньше кнопка была
            одна на весь блок и открывала каталог по умолчанию, теряя ряд, из
            которого человек её нажал. */}
        <Link
          href={catalogHref}
          className="press group flex items-center gap-2 rounded-full bg-accent/15 px-4 py-1.5 text-sm font-semibold text-accent-text ring-1 ring-accent/30 transition hover:bg-accent hover:text-accent-fg hover:ring-accent"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0">
            <g className="fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 5.5h14M3 10h14M3 14.5h9" />
            </g>
          </svg>
          Весь каталог
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </div>
      {children}
    </section>
  );
}

/** Карусель одного ряда или null, если индекс пуст/недоступен. */
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
    return <RecommendedCarousel contentType="anime" items={page.items} />;
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
  return <RecommendedCarousel contentType="cinema" items={page.items} />;
}

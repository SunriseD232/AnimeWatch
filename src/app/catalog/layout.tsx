import { Suspense } from 'react';
import ModeSwitch from '@/components/ModeSwitch';
import CatalogFilterProvider from '@/components/catalog/CatalogFilterProvider';
import AnimeCatalogSidebar from '@/components/catalog/AnimeCatalogSidebar';
import AnimeGenrePanel from '@/components/catalog/AnimeGenrePanel';
import CatalogMobileDrawer from '@/components/catalog/CatalogMobileDrawer';
import CatalogMobileTrigger from '@/components/catalog/CatalogMobileTrigger';
import { ANIME_CATALOG_SORTS, getAnimeGenres, type AnimeCatalogSort } from '@/lib/shikimori';
import type { FilterOptionDef } from '@/lib/animeFilters';

const DEFAULT_SORT: AnimeCatalogSort = 'aired_on';

/**
 * Жанры тянутся один раз и отдаются ОБОИМ потребителям — верхней панели
 * (десктоп) и выезжающей шторке (телефон). Поэтому запрос живёт здесь, а не
 * внутри каждого из них: два одинаковых похода к Shikimori за одним и тем же
 * списком не нужны, а список к тому же кэшируется на сутки.
 */
async function CatalogFilters({ children }: { children: React.ReactNode }) {
  let genres: { id: number; russian: string }[] = [];
  try {
    genres = await getAnimeGenres();
  } catch {
    genres = [];
  }
  const options: FilterOptionDef[] = genres.map((g) => ({
    value: String(g.id),
    label: g.russian,
  }));

  return (
    <CatalogFilterProvider defaultSort={DEFAULT_SORT}>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Каталог аниме</h1>
            <p className="text-sm text-gray-400">
              {/* Без «слева»: на узких экранах фильтры не в колонке, а в
                  панели по кнопке — указание направления там врало бы. */}
              Выбирайте жанры и фильтры (клик — включить, ещё раз —
              исключить), затем нажмите «Применить».
            </p>
          </div>
          <CatalogMobileTrigger />
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* На телефоне колонка не сворачивается, а исчезает совсем: те же
              группы там показывает шторка, и две копии разом спорили бы за
              один черновик визуально. */}
          <aside className="hidden lg:sticky lg:top-4 lg:block lg:w-60 lg:shrink-0">
            <AnimeCatalogSidebar />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <AnimeGenrePanel genres={options} sorts={ANIME_CATALOG_SORTS} />
            {children}
          </div>
        </div>
      </div>

      <CatalogMobileDrawer genres={options} sorts={ANIME_CATALOG_SORTS} />
    </CatalogFilterProvider>
  );
}

export default function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ModeSwitch active="anime" />

      {/* Suspense — из-за useSearchParams внутри провайдера: без него сборка
          падает на пререндере. Заодно закрывает и await за жанрами. */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}>
        <CatalogFilters>{children}</CatalogFilters>
      </Suspense>
    </div>
  );
}

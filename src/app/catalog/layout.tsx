import { Suspense } from 'react';
import ModeSwitch from '@/components/ModeSwitch';
import CatalogFilterProvider from '@/components/catalog/CatalogFilterProvider';
import AnimeCatalogSidebar from '@/components/catalog/AnimeCatalogSidebar';
import AnimeGenrePanel from '@/components/catalog/AnimeGenrePanel';
import { ANIME_CATALOG_SORTS, getAnimeGenres, type AnimeCatalogSort } from '@/lib/shikimori';

const DEFAULT_SORT: AnimeCatalogSort = 'aired_on';

async function GenresPanel() {
  let genres: { id: number; russian: string }[] = [];
  try {
    genres = await getAnimeGenres();
  } catch {
    genres = [];
  }
  return (
    <AnimeGenrePanel
      genres={genres.map((g) => ({ value: String(g.id), label: g.russian }))}
      sorts={ANIME_CATALOG_SORTS}
    />
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

      <div>
        <h1 className="text-xl font-bold">Каталог аниме</h1>
        <p className="text-sm text-gray-400">
          {/* Без «слева»: на узких экранах колонка фильтров уезжает НАД
              выдачей, и указание направления там врало бы. */}
          Выбирайте жанры и фильтры (клик — включить, ещё раз — исключить),
          затем нажмите «Применить».
        </p>
      </div>

      {/* Провайдер обязан оборачивать И сайдбар, И панель жанров: черновик у
          них общий, кнопка «Применить» одна (см. CatalogFilterProvider).
          Suspense — из-за useSearchParams внутри: без него сборка падает на
          пререндере статических страниц. */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}>
        <CatalogFilterProvider defaultSort={DEFAULT_SORT}>
          {/* На узких экранах фильтры уезжают НАД выдачей, а не в колонку:
              рельс шириной в пол-экрана на телефоне не оставил бы места
              карточкам. */}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <aside className="lg:sticky lg:top-4 lg:w-60 lg:shrink-0">
              <AnimeCatalogSidebar />
            </aside>

            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <GenresPanel />
              {children}
            </div>
          </div>
        </CatalogFilterProvider>
      </Suspense>
    </div>
  );
}

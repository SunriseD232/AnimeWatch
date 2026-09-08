import { Suspense } from 'react';
import ModeSwitch from '@/components/ModeSwitch';
import CatalogFilterProvider from '@/components/catalog/CatalogFilterProvider';
import AnimeGenrePanel from '@/components/catalog/AnimeGenrePanel';
import CatalogMobileDrawer from '@/components/catalog/CatalogMobileDrawer';
import CatalogMobileTrigger from '@/components/catalog/CatalogMobileTrigger';
import { ANIME_CATALOG_SORTS, getAnimeGenres, type AnimeCatalogSort } from '@/lib/shikimori';
import { getGenresFromIndex } from '@/lib/animeIndexQuery';
import type { FilterOptionDef } from '@/lib/animeFilters';

const DEFAULT_SORT: AnimeCatalogSort = 'aired_on';

/**
 * Жанры тянутся один раз и отдаются ОБОИМ потребителям — верхней панели
 * (десктоп) и выезжающей шторке (телефон). Поэтому запрос живёт здесь, а не
 * внутри каждого из них: два одинаковых похода к Shikimori за одним и тем же
 * списком не нужны, а список к тому же кэшируется на сутки.
 */
async function CatalogFilters({ children }: { children: React.ReactNode }) {
  // Список берём из локального индекса: там актуальная таксономия Shikimori
  // (22 жанра, 53 темы, 5 демографий). Легаси-эндпоинт REST /genres отдаёт
  // 46 записей, среди которых мёртвая «Магия» — кнопка есть, результатов
  // нет. Индекса ещё нет — откатываемся на него же, чтобы каталог не остался
  // вовсе без фильтра по жанрам.
  let genres: { id: number; russian: string }[] = [];
  try {
    genres = (await getGenresFromIndex()) ?? (await getAnimeGenres());
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Каталог аниме</h1>
            {/* Только десктоп: на телефоне подсказка съедала верх экрана
                перед самой выдачей, а объяснять там нечего — жанры и
                фильтры спрятаны в панель, и та же фраза про клики есть
                внутри неё, рядом с самими чекбоксами. */}
            <p className="hidden text-sm text-gray-400 lg:block">
              Выбирайте жанры и фильтры (клик — включить, ещё раз —
              исключить), затем нажмите «Применить».
            </p>
          </div>
          <CatalogMobileTrigger />
        </div>

        {/* Одна колонка во всю ширину: кнопка «Фильтры» живёт внутри
            AnimeGenrePanel, а её панель раскрывается накладкой поверх
            контента. Колонки в потоке тут нет намеренно — она сдвигала
            вправо и жанры, и сетку карточек. */}
        <AnimeGenrePanel genres={options} sorts={ANIME_CATALOG_SORTS} />
        {children}
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

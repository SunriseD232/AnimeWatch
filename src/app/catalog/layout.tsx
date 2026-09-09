import { Suspense } from 'react';
import ModeSwitch from '@/components/ModeSwitch';
import CatalogFilterProvider from '@/components/catalog/CatalogFilterProvider';
import CatalogArea from '@/components/catalog/CatalogArea';
import AnimeGenrePanel from '@/components/catalog/AnimeGenrePanel';
import CatalogMobileDrawer from '@/components/catalog/CatalogMobileDrawer';
import CatalogMobileTrigger from '@/components/catalog/CatalogMobileTrigger';
import { ANIME_CATALOG_SORTS, getAnimeGenres, type AnimeCatalogSort } from '@/lib/shikimori';
import { getGenresFromIndex } from '@/lib/animeIndexQuery';
import type { FilterOptionDef } from '@/lib/animeFilters';

const DEFAULT_SORT: AnimeCatalogSort = 'aired_on';

/**
 * Жанры тянутся один раз и отдаются обоим потребителям — панели фильтров на
 * десктопе и выезжающей шторке на телефоне.
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
      {/* Заголовок — отдельным слотом, вне рельса панели: иначе панель
          вставала бы на его уровень, а не на уровень кнопки «Фильтры».
          order-* задают порядок внутри рельса: панель он ставит между
          тулбаром и выдачей (order-2). */}
      <CatalogArea
        genres={options}
        header={
          <div className="flex items-center justify-between gap-3">
            {/* Подсказка про клики переехала внутрь панели фильтров, к самим
                чекбоксам: сверху она объясняла то, чего на экране уже нет. */}
            <h1 className="text-xl font-bold">Каталог аниме</h1>
            <CatalogMobileTrigger />
          </div>
        }
      >
        <div className="order-1">
          <AnimeGenrePanel sorts={ANIME_CATALOG_SORTS} />
        </div>

        <div className="order-3">{children}</div>
      </CatalogArea>

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
      {/* ModeSwitch снаружи Suspense: он ни от каких данных не зависит и
          должен появляться сразу, не дожидаясь списка жанров. */}
      <ModeSwitch active="anime" />

      {/* Suspense — из-за useSearchParams внутри провайдера: без него сборка
          падает на пререндере. Заодно закрывает и await за жанрами. */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}>
        <CatalogFilters>{children}</CatalogFilters>
      </Suspense>
    </div>
  );
}

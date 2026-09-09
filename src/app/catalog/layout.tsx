import { Suspense } from 'react';
import ModeSwitch from '@/components/ModeSwitch';
import CatalogFilterProvider from '@/components/catalog/CatalogFilterProvider';
import CatalogArea from '@/components/catalog/CatalogArea';
import CatalogToolbar from '@/components/catalog/CatalogToolbar';
import CatalogMobileDrawer from '@/components/catalog/CatalogMobileDrawer';
import CatalogMobileTrigger from '@/components/catalog/CatalogMobileTrigger';
import { getAnimeGenres } from '@/lib/shikimori';
import { getGenresFromIndex } from '@/lib/animeIndexQuery';
import { ANIME_FILTER_CONFIG } from '@/lib/animeFilters';
import type { FilterOptionDef } from '@/lib/catalogFilters';

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
  const genreOptions: FilterOptionDef[] = genres.map((g) => ({
    value: String(g.id),
    label: g.russian,
  }));
  const options = { genres: genreOptions };

  return (
    <CatalogFilterProvider config={ANIME_FILTER_CONFIG}>
      {/* Заголовок и тулбар — отдельными слотами: панель занимает колонку
          только в ряду с карточками, поэтому её верх совпадает с верхом
          тайтлов, а не с «Каталогом аниме» и не с кнопкой «Фильтры». */}
      <CatalogArea
        options={options}
        header={
          <div className="flex items-center justify-between gap-3">
            {/* Подсказка про клики переехала внутрь панели фильтров, к самим
                чекбоксам: сверху она объясняла то, чего на экране уже нет. */}
            <h1 className="text-xl font-bold">Каталог аниме</h1>
            <CatalogMobileTrigger />
          </div>
        }
        toolbar={<CatalogToolbar />}
      >
        {children}
      </CatalogArea>

      <CatalogMobileDrawer options={options} />
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

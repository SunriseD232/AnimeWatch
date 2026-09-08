'use client';

import { AnonsToggle, GenreChips, SortSelect } from '@/components/catalog/FilterGroups';
import CatalogDesktopFilters from '@/components/catalog/CatalogDesktopFilters';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Верхняя панель каталога аниме: сортировка, «Показывать анонсы» и чипы
 * жанров. Отличается от общего GenreFilterPanel (он остался у каталога кино)
 * тем, что черновик берёт из общего контекста — чтобы жанры сверху и фильтры
 * в левой колонке применялись одной кнопкой.
 *
 * Только десктоп: на телефоне жанры переехали внутрь выезжающей панели
 * (CatalogMobileDrawer), чтобы не отодвигать выдачу на пару экранов вниз.
 */
export default function AnimeGenrePanel({
  genres,
  sorts,
}: {
  genres: FilterOptionDef[];
  sorts: readonly FilterOptionDef[];
}) {
  return (
    <div className="hidden flex-col gap-4 lg:flex">
      {/* Кнопка «Фильтры» — первой в этой же строке: слева и без отдельной
          строки под себя. Сама панель раскрывается накладкой и раскладку не
          двигает (см. CatalogDesktopFilters). */}
      <div className="flex flex-wrap items-center gap-4">
        <CatalogDesktopFilters />
        <SortSelect sorts={sorts} />
        <AnonsToggle />
      </div>

      <div className="-mx-4 px-4">
        <GenreChips genres={genres} />
      </div>
    </div>
  );
}

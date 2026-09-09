'use client';

import { AnonsToggle, SortSelect } from '@/components/catalog/FilterGroups';
import { FiltersTrigger } from '@/components/catalog/CatalogDesktopFilters';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Верхняя строка каталога аниме на десктопе: кнопка «Фильтры», сортировка и
 * «Показывать анонсы». Только строка — саму панель рисует CatalogArea, ей
 * нужен рельс во всю высоту каталога, а он не может быть потомком тулбара.
 *
 * Жанры отсюда убраны и живут внутри панели вместе с остальными группами:
 * строкой чипов они занимали несколько экранов по вертикали, а с переходом
 * на актуальную таксономию Shikimori пунктов стало 80 вместо 46.
 *
 * Только десктоп: на телефоне всё то же самое живёт в выезжающей шторке
 * (CatalogMobileDrawer).
 */
export default function AnimeGenrePanel({ sorts }: { sorts: readonly FilterOptionDef[] }) {
  const { filtersOpen, setFiltersOpen } = useCatalogFilters();

  return (
    <div className="hidden flex-wrap items-center gap-4 lg:flex">
      <FiltersTrigger open={filtersOpen} onToggle={() => setFiltersOpen(!filtersOpen)} />
      <SortSelect sorts={sorts} />
      <AnonsToggle />
    </div>
  );
}

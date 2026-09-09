'use client';

import { AnonsToggle, SortSelect } from '@/components/catalog/FilterGroups';
import { FiltersTrigger } from '@/components/catalog/CatalogDesktopFilters';
import ViewSwitch from '@/components/catalog/ViewSwitch';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';

/**
 * Верхняя строка каталога на десктопе: кнопка «Фильтры», вид, сортировка и —
 * у аниме — галка «Показывать анонсы». Только строка: саму панель рисует
 * CatalogArea, ей нужна собственная колонка рядом с карточками, а она не
 * может быть потомком тулбара.
 *
 * Общая для обоих каталогов. Что именно показывать, решает конфиг
 * (showViewSwitch, showAnonsToggle) — у кино нет строчной карточки, поэтому
 * переключателя вида там нет, а анонсов нет как понятия.
 *
 * Только десктоп: на телефоне всё то же самое живёт в выезжающей шторке
 * (CatalogMobileDrawer).
 */
export default function CatalogToolbar() {
  const { filtersOpen, setFiltersOpen, config } = useCatalogFilters();

  return (
    <div className="hidden flex-wrap items-center gap-4 lg:flex">
      <FiltersTrigger open={filtersOpen} onToggle={() => setFiltersOpen(!filtersOpen)} />
      {config.showViewSwitch && <ViewSwitch />}
      <SortSelect />
      <AnonsToggle />
    </div>
  );
}

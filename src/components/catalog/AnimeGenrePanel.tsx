'use client';

import { useEffect, useRef, useState } from 'react';
import { AnonsToggle, GenreChips, SortSelect } from '@/components/catalog/FilterGroups';
import {
  FILTERS_SIDE_BREAKPOINT,
  FiltersPanel,
  FiltersTrigger,
} from '@/components/catalog/CatalogDesktopFilters';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Верхняя панель каталога аниме: кнопка «Фильтры», сортировка, «Показывать
 * анонсы» и чипы жанров. Отличается от общего GenreFilterPanel (он остался у
 * каталога кино) тем, что черновик берёт из общего контекста — чтобы жанры и
 * фильтры применялись одной кнопкой.
 *
 * Состояние «панель фильтров открыта» живёт здесь, а не внутри самой панели:
 * кнопка стоит в строке с сортировкой, а панель — отдельным узлом ниже (на
 * узком окне она должна вставать В ПОТОК над жанрами, а вложенной в кнопку
 * это невозможно). Общий родитель для них двоих — этот компонент.
 *
 * Только десктоп: на телефоне и жанры, и фильтры живут в выезжающей шторке
 * (CatalogMobileDrawer).
 */
export default function AnimeGenrePanel({
  genres,
  sorts,
}: {
  genres: FilterOptionDef[];
  sorts: readonly FilterOptionDef[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      // Клик мимо закрывает только когда панель ВИСИТ НАКЛАДКОЙ сбоку. В
      // потоке (узкое окно) она обычный раскрытый блок, и захлопывать его от
      // клика по странице — неожиданное поведение: ничего ведь не перекрыто.
      if (window.innerWidth < FILTERS_SIDE_BREAKPOINT) return;
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    // relative — точка отсчёта для накладки на широком окне: панель уходит
    // за левый край этого блока (right-full), то есть ровно в пустое поле
    // слева от контента.
    <div ref={rootRef} className="relative hidden flex-col gap-4 lg:flex">
      <div className="flex flex-wrap items-center gap-4">
        <FiltersTrigger open={open} onToggle={() => setOpen((v) => !v)} />
        <SortSelect sorts={sorts} />
        <AnonsToggle />
      </div>

      {open && <FiltersPanel />}

      <div className="-mx-4 px-4">
        <GenreChips genres={genres} />
      </div>
    </div>
  );
}

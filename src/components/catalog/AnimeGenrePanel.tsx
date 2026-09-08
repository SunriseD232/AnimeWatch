'use client';

import { useEffect, useRef, useState } from 'react';
import { AnonsToggle, SortSelect } from '@/components/catalog/FilterGroups';
import {
  FILTERS_SIDE_BREAKPOINT,
  FiltersPanel,
  FiltersTrigger,
} from '@/components/catalog/CatalogDesktopFilters';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Верхняя строка каталога аниме на десктопе: кнопка «Фильтры», сортировка и
 * «Показывать анонсы». Больше ничего — жанры отсюда убраны и живут внутри
 * панели фильтров вместе с остальными группами. Строкой чипов они занимали
 * несколько экранов по вертикали, а с переходом на актуальную таксономию
 * Shikimori пунктов стало 80 вместо 46.
 *
 * Состояние «панель открыта» живёт здесь, а не внутри самой панели: кнопка
 * стоит в этой строке, а панель — отдельным узлом ниже (на узком окне она
 * должна вставать В ПОТОК, а вложенной в кнопку это невозможно). Общий
 * родитель для них двоих — этот компонент.
 *
 * Только десктоп: на телефоне всё то же самое живёт в выезжающей шторке
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

      {open && <FiltersPanel genres={genres} />}
    </div>
  );
}

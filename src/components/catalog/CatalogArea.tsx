'use client';

import { useEffect, useRef } from 'react';
import {
  FILTERS_SIDE_BREAKPOINT,
  FiltersPanel,
} from '@/components/catalog/CatalogDesktopFilters';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Каркас страницы каталога: шапка, тулбар и выдача приходят готовыми
 * (children, порядок задан классами order-*), а панель фильтров рисуется
 * здесь.
 *
 * Почему панель именно тут, а не внутри тулбара, как раньше. У неё два
 * режима, и в широком ей нужен «рельс» — невидимый контейнер во ВСЮ высоту
 * каталога, внутри которого она липнет. Рельс обязан быть братом выдачи, а
 * не потомком тулбара: только тогда его нижняя граница совпадает с концом
 * последних карточек.
 *
 * Что это даёт при прокрутке (широкое окно):
 *  - панель не уезжает выше шапки сайта — sticky держит её под ней;
 *  - и не уходит ниже последних карточек — рельс там кончается, и дальше
 *    панель уезжает вместе со страницей.
 * Прежний absolute просто прокручивался вместе со всем и исчезал вверху.
 *
 * На узком окне рельс становится обычным блоком в потоке (order-3, между
 * тулбаром и выдачей) — слева места нет, и панель честно раздвигает контент
 * вниз.
 *
 * data-filters-open на корне — для сетки карточек: при открытой панели она
 * переходит на более мелкие (см. .catalog-grid в globals.css). Через CSS, а
 * не через классы Tailwind у самой сетки, потому что сетку рендерит сервер,
 * а состояние панели живёт на клиенте.
 */
export default function CatalogArea({
  genres,
  children,
}: {
  genres: FilterOptionDef[];
  children: React.ReactNode;
}) {
  const { filtersOpen, setFiltersOpen } = useCatalogFilters();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;

    const onDown = (e: MouseEvent) => {
      // Клик мимо закрывает только когда панель ВИСИТ НАКЛАДКОЙ сбоку. В
      // потоке (узкое окно) она обычный раскрытый блок, и захлопывать его от
      // клика по странице — неожиданно: ничего ведь не перекрыто.
      if (window.innerWidth < FILTERS_SIDE_BREAKPOINT) return;
      if (!rootRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen, setFiltersOpen]);

  return (
    <div
      ref={rootRef}
      data-filters-open={filtersOpen}
      className="relative flex flex-col gap-6"
    >
      {children}

      {filtersOpen && (
        <div className="order-3 min-[1600px]:absolute min-[1600px]:inset-y-0 min-[1600px]:right-full min-[1600px]:z-30 min-[1600px]:mr-5 min-[1600px]:w-52">
          {/* top под шапкой сайта: она sticky top-0 и высотой 67px, плюс
              небольшой зазор, чтобы панель не липла к ней вплотную.

              max-h обязателен: без него панель (со всеми раскрытыми
              группами это ~1170px) оказывается ВЫШЕ самого рельса, и тогда
              она, во-первых, торчит ниже последних карточек, во-вторых,
              липкость просто не работает — sticky нечего прижимать, если
              элемент длиннее своего контейнера. С ограничением по высоте
              экрана панель всегда короче рельса, липнет под шапкой, а у
              нижней границы выдачи уезжает вместе с ней. Своя прокрутка
              появляется только когда панель реально не влезает в экран. */}
          <div className="min-[1600px]:sticky min-[1600px]:top-[4.5rem] min-[1600px]:max-h-[calc(100vh-5.5rem)] min-[1600px]:overflow-y-auto">
            <FiltersPanel genres={genres} />
          </div>
        </div>
      )}
    </div>
  );
}

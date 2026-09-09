'use client';

import { useEffect, useRef } from 'react';
import {
  FILTERS_SIDE_BREAKPOINT,
  FiltersPanel,
} from '@/components/catalog/CatalogDesktopFilters';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Каркас страницы каталога: заголовок приходит отдельным слотом, тулбар и
 * выдача — через children (порядок задан классами order-*), а панель
 * фильтров рисуется здесь.
 *
 * Заголовок вынесен ИЗ внутренней обёртки намеренно. Панели в широком режиме
 * нужен «рельс» — невидимый контейнер, внутри которого она липнет, — и его
 * границы задаются этой обёрткой. Пока заголовок был внутри, рельс начинался
 * от «Каталог аниме», и панель вставала выше строки с кнопкой «Фильтры».
 * Теперь обёртка охватывает ровно тулбар и выдачу, поэтому:
 *  - верх панели совпадает со строкой кнопки «Фильтры»;
 *  - низ рельса совпадает с концом последних карточек, и ниже них панель не
 *    уходит.
 *
 * При прокрутке панель липнет под шапкой сайта и уезжает только когда
 * кончается рельс. Прежний absolute просто уплывал вверх вместе со страницей.
 *
 * На узком окне рельс становится обычным блоком в потоке (order-2, между
 * тулбаром и выдачей) — слева места нет, и панель честно раздвигает контент
 * вниз.
 *
 * data-filters-open на корне — для сужения всей колонки каталога при открытой
 * панели (см. .catalog-shell в globals.css). Именно всей: переключатель
 * «Аниме / Фильмы и сериалы», заголовок, тулбар и выдача обязаны сужаться
 * заодно. Когда сужалась одна сетка, она расходилась по ширине с
 * переключателем над ней, и это читалось как сбитое выравнивание.
 */
export default function CatalogArea({
  genres,
  header,
  children,
}: {
  genres: FilterOptionDef[];
  header: React.ReactNode;
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
    <div data-filters-open={filtersOpen} className="catalog-shell flex flex-col gap-6">
      {header}

      <div ref={rootRef} className="relative flex flex-col gap-6">
        {children}

        {filtersOpen && (
          // -top-1.5 = внутренний отступ панели (12px) минус то, на сколько
          // сама кнопка «Фильтры» опущена внутри строки тулбара (6px: строка
          // выравнивает элементы по центру, а самый высокий в ней — селект
          // сортировки). Без этой поправки первый заголовок панели вставал
          // выше кнопки. Правим рельс, а не липкую обёртку — у той свой
          // отступ под шапкой, и сдвиг там утащил бы панель под неё при
          // прокрутке.
          <div className="order-2 min-[1600px]:absolute min-[1600px]:inset-y-0 min-[1600px]:-top-1.5 min-[1600px]:right-full min-[1600px]:z-30 min-[1600px]:mr-5 min-[1600px]:w-52">
            {/* max-h обязателен: панель длиннее рельса не липнет в принципе —
                sticky нечего прижимать, — и торчит ниже последних карточек.
                Своя прокрутка появляется только когда она реально не влезает
                в экран. */}
            <div className="no-scrollbar min-[1600px]:sticky min-[1600px]:top-[4.5rem] min-[1600px]:max-h-[calc(100vh-5.5rem)] min-[1600px]:overflow-y-auto">
              <FiltersPanel genres={genres} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

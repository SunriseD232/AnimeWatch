'use client';

import { useEffect, useRef } from 'react';
import {
  FILTERS_SIDE_BREAKPOINT,
  FiltersPanel,
} from '@/components/catalog/CatalogDesktopFilters';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Каркас страницы каталога: заголовок и тулбар приходят слотами, выдача —
 * через children, а панель фильтров рисуется здесь.
 *
 * Панель ВСЕГДА слева от выдачи. Меняется только то, откуда она берёт место:
 *
 *  - от 1920px — из поля страницы. Контент прижат к центру и не шире 1152px,
 *    так что слева остаётся 384px при нужных 228 (208 панель + 20 отступ).
 *    Панель absolute, в раскладке не участвует: выдача остаётся во всю ширину,
 *    карточки не меняются вовсе.
 *  - уже 1920px — настоящей колонкой внутри контента. Поля не хватает: при
 *    1536 (это FullHD при масштабе 125%) слева всего 192px. Колонка отнимает
 *    ширину у выдачи, и карточки честно мельчают — это и есть «места нет,
 *    поэтому уменьшаем». Раскрываться вниз, над выдачей, панель больше не
 *    умеет: её место — сбоку.
 *
 * Пара «панель + выдача» вместе занимает всю ширину контейнера, а он прижат
 * к центру страницы — то есть центрируются они именно вместе, как одно целое,
 * и по краям совпадают с полосой «Аниме / Фильмы и сериалы» над ними.
 *
 * Ряд начинается там же, где первая карточка, поэтому и верх панели совпадает
 * с верхом тайтлов, а не с тулбаром.
 *
 * data-filters-open на корне — для сетки карточек (см. .catalog-grid в
 * globals.css). Через CSS, а не классы Tailwind у самой сетки, потому что
 * сетку рендерит сервер, а состояние панели живёт на клиенте.
 */
export default function CatalogArea({
  genres,
  header,
  toolbar,
  children,
}: {
  genres: FilterOptionDef[];
  header: React.ReactNode;
  toolbar: React.ReactNode;
  children: React.ReactNode;
}) {
  const { filtersOpen, setFiltersOpen } = useCatalogFilters();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;

    const onDown = (e: MouseEvent) => {
      // Клик мимо закрывает только когда панель висит НАКЛАДКОЙ в поле
      // страницы. Когда она занимает собственную колонку, это обычный
      // раскрытый блок, и захлопывать его от клика по странице — неожиданно:
      // ничего ведь не перекрыто.
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
    <div data-filters-open={filtersOpen} className="flex flex-col gap-6">
      {header}

      <div ref={rootRef} className="flex flex-col gap-6">
        {toolbar}

        <div className="relative flex">
          {/* Колонка панели. Ширину анимируем, а не монтируем скачком: вместе
              с ней плавно едет ширина выдачи, то есть и размер карточек.
              Поэтому узел в разметке всегда, а закрытое состояние — нулевая
              ширина.

              Обрезки (overflow-hidden) здесь быть НЕ должно: она сделала бы
              колонку скролл-контейнером, и sticky внутри перестал бы липнуть —
              прижимать было бы не к чему. Панель обрезает липкая обёртка
              внутри: у неё своя прокрутка, и она сама себе скролл-контейнер,
              так что на sticky это не влияет. */}
          <aside
            aria-hidden={!filtersOpen}
            className={`hidden shrink-0 transition-[width,margin-right] duration-[420ms] ease-[cubic-bezier(0.4,0,0.2,1)] lg:block min-[1920px]:absolute min-[1920px]:inset-y-0 min-[1920px]:right-full min-[1920px]:z-30 min-[1920px]:mr-5 min-[1920px]:w-52 ${
              filtersOpen ? 'mr-5 w-52' : 'mr-0 w-0'
            }`}
          >
            {/* -mt-3 гасит внутренний отступ панели: выравниваем по её
                содержимому, а не по краю фона, — первый заголовок встаёт
                ровно на высоту верха первой карточки.

                max-h обязателен: панель длиннее своей колонки не липнет в
                принципе и торчит ниже последних карточек. Своя прокрутка
                появляется только когда она реально не влезает в экран. */}
            <div className="no-scrollbar sticky top-[4.5rem] -mt-3 max-h-[calc(100vh-5.5rem)] overflow-y-auto overflow-x-hidden">
              {/* Ширина зафиксирована, чтобы во время анимации колонки текст
                  внутри не переливался: панель выезжает целиком, а не
                  пересобирается на каждом кадре. */}
              {filtersOpen && (
                <div className="w-52">
                  <FiltersPanel genres={genres} />
                </div>
              )}
            </div>
          </aside>

          {/* min-w-0 — иначе сетка не даёт флекс-элементу сжиматься ниже
              своего содержимого, и колонка панели выдавливает выдачу за край
              вместо того, чтобы её ужать. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

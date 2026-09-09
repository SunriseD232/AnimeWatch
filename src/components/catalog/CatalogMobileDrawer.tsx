'use client';

import { useEffect, useRef } from 'react';
import CollapsibleSection from '@/components/catalog/CollapsibleSection';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import {
  AnonsToggle,
  EpisodesRange,
  GenreList,
  KindGroup,
  RatingGroup,
  SortSelect,
  StatusGroup,
  YearRange,
  useGroupCount,
} from '@/components/catalog/FilterGroups';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Мобильная панель фильтров: выезжает справа поверх выдачи по кнопке-
 * гамбургеру (CatalogMobileTrigger). Держит В ОДНОМ месте всё, что на
 * десктопе разнесено — жанры, диапазоны, рейтинг, тип, статус и сортировку.
 *
 * Почему шторка, а не раскрывающийся блок в потоке страницы: на телефоне
 * шесть групп фильтров плюс 40+ жанров занимают несколько экранов, и в
 * потоке они отодвигали бы саму выдачу далеко вниз. Поверх контента панель
 * закрывается одним касанием и не сдвигает то, ради чего пришли.
 *
 * Панель остаётся в DOM всегда (не размонтируется при закрытии) ради
 * анимации выезда — но её внутренние секции по умолчанию свёрнуты и
 * содержимое не рендерят, см. CollapsibleSection.
 */
export default function CatalogMobileDrawer({
  genres,
  sorts,
}: {
  genres: FilterOptionDef[];
  sorts: readonly FilterOptionDef[];
}) {
  const { drawerOpen, setDrawerOpen, dirty, hasFilters, apply, reset } = useCatalogFilters();
  const panelRef = useRef<HTMLDivElement>(null);

  const genresCount = useGroupCount('genres');
  const ratingsCount = useGroupCount('ratings');
  const kindsCount = useGroupCount('kinds');
  const statusesCount = useGroupCount('statuses');

  // Escape закрывает — обычное ожидание от модальной шторки.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, setDrawerOpen]);

  // Блокируем прокрутку страницы под шторкой: без этого палец, дойдя до
  // конца списка фильтров, начинает листать выдачу под ней — на телефоне
  // это выглядит как будто панель «поехала».
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Фокус внутрь панели при открытии — иначе он остаётся на кнопке позади
  // шторки, и навигация с клавиатуры продолжается по скрытому контенту.
  useEffect(() => {
    if (drawerOpen) panelRef.current?.focus();
  }, [drawerOpen]);

  function applyAndClose() {
    apply();
    setDrawerOpen(false);
  }

  return (
    <div
      className={`fixed inset-0 z-50 lg:hidden ${drawerOpen ? '' : 'pointer-events-none'}`}
      aria-hidden={!drawerOpen}
    >
      <div
        onClick={() => setDrawerOpen(false)}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${
          drawerOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Жанры и фильтры"
        tabIndex={-1}
        className={`absolute right-0 top-0 flex h-full w-[86%] max-w-sm flex-col bg-bg-card shadow-2xl outline-none transition-transform duration-300 ease-out ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="text-base font-semibold text-gray-100">Жанры и фильтры</p>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Закрыть"
            className="press rounded-lg p-1.5 text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* pb с safe-area — на iPhone нижняя полоска-индикатор иначе
            перекрывает последнюю секцию списка. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom)]">
          <div className="flex flex-wrap items-center gap-4 py-3">
            <SortSelect sorts={sorts} />
            <AnonsToggle />
          </div>

          <CollapsibleSection title="Жанры" count={genresCount}>
            <GenreList genres={genres} />
          </CollapsibleSection>

          <CollapsibleSection title="Количество эпизодов">
            <EpisodesRange />
          </CollapsibleSection>

          <CollapsibleSection title="Год релиза">
            <YearRange />
          </CollapsibleSection>

          <CollapsibleSection title="Тип" count={kindsCount}>
            <KindGroup />
          </CollapsibleSection>

          <CollapsibleSection title="Статус тайтла" count={statusesCount}>
            <StatusGroup />
          </CollapsibleSection>

          {/* Возрастной рейтинг — последним, тот же порядок и на десктопе
              (см. CatalogDesktopFilters). */}
          <CollapsibleSection title="Возрастной рейтинг" count={ratingsCount}>
            <RatingGroup />
          </CollapsibleSection>

          <p className="py-3 text-xs leading-snug text-gray-500">
            Первое нажатие включает пункт, второе — исключает (крестик), третье снимает.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={applyAndClose}
            disabled={!dirty}
            className="press flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Применить
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={reset}
              className="press rounded-full bg-white/5 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-white/10"
            >
              Сбросить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

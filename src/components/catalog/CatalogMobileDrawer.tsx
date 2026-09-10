'use client';

import { useEffect, useRef, useState } from 'react';
import CollapsibleSection from '@/components/catalog/CollapsibleSection';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import {
  AnonsToggle,
  RangeGroup,
  SortSelect,
  TriGroupBody,
} from '@/components/catalog/FilterGroups';
import type { FilterOptionDef } from '@/lib/catalogFilters';

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
 *
 * Шторка начинается ПОД шапкой сайта, а не от края экрана. Пока она была
 * fixed inset-0, на iPhone её заголовок заезжал под часы и индикатор
 * заряда: fixed-элемент не наследует padding безопасной зоны, который висит
 * на body. Отступ считаем по реальной высоте шапки (она разная на телефоне
 * и на десктопе, и меняется при повороте), а не константой — прошлая
 * константа 57px в фолбэке layout.tsx уже разошлась с фактическими 67px.
 */
export default function CatalogMobileDrawer({
  options,
}: {
  /** Динамические списки пунктов по ключу группы (жанры, страны). */
  options: Record<string, FilterOptionDef[]>;
}) {
  const { drawerOpen, setDrawerOpen, dirty, hasFilters, apply, reset, config, pending } =
    useCatalogFilters();
  const panelRef = useRef<HTMLDivElement>(null);
  const [headerBottom, setHeaderBottom] = useState(0);

  // Низ шапки в координатах вьюпорта — он же верх шторки. Шапка липкая
  // (sticky top-0), поэтому при прокрутке значение не меняется, но пересчёт
  // на поворот экрана нужен: там меняется и высота шапки, и безопасная зона.
  useEffect(() => {
    const measure = () => {
      const header = document.querySelector('header');
      setHeaderBottom(header ? Math.round(header.getBoundingClientRect().bottom) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [drawerOpen]);

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
      // top по низу шапки: сама шапка остаётся видимой и рабочей — поиск под
      // рукой, и ничего не заезжает под часы и заряд на iPhone.
      style={{ top: headerBottom }}
      className={`fixed inset-x-0 bottom-0 z-50 lg:hidden ${drawerOpen ? '' : 'pointer-events-none'}`}
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
            <SortSelect />
            <AnonsToggle />
          </div>

          {/* Порядок секций — из конфига, тот же, что и на десктопе (см.
              CatalogDesktopFilters): иначе фильтр на телефоне и на
              компьютере со временем разъедутся. */}
          {config.tri.map((def) => {
            const items = def.options ?? options[def.key] ?? [];
            if (items.length === 0) return null;
            const state = pending.tri[def.key];
            const count = state ? state.include.length + state.exclude.length : 0;
            return (
              <CollapsibleSection key={def.key} title={def.title} count={count}>
                <TriGroupBody def={def} options={items} />
              </CollapsibleSection>
            );
          })}

          {/* Диапазоны — в конце: это единственные поля с вводом, остальное
              выбирается касанием. */}
          {config.ranges.map((def) => (
            <CollapsibleSection key={def.key} title={def.title}>
              <RangeGroup def={def} />
            </CollapsibleSection>
          ))}

          <p className="py-3 text-xs leading-snug text-gray-500">
            Первое нажатие включает пункт, второе — исключает (крестик), третье снимает.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={applyAndClose}
            disabled={!dirty}
            className="press flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
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

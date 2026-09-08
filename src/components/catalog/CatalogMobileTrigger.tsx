'use client';

import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import { hasAnyFilter } from '@/lib/animeFilters';

/**
 * Кнопка «три полоски» в углу шапки каталога — открывает мобильную панель
 * фильтров (CatalogMobileDrawer). Только на узких экранах: на десктопе всё
 * и так на виду, колонка слева и жанры сверху.
 *
 * Точка у иконки, когда фильтры применены: иначе после закрытия панели
 * ничего не напоминает, что выдача уже сужена, и «мало результатов»
 * выглядит как поломка каталога.
 */
export default function CatalogMobileTrigger() {
  const { applied, setDrawerOpen } = useCatalogFilters();
  const active = hasAnyFilter(applied);

  return (
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      aria-label={active ? 'Жанры и фильтры (применены)' : 'Жанры и фильтры'}
      aria-haspopup="dialog"
      className="press relative shrink-0 rounded-xl border border-white/10 bg-bg-card p-2.5 text-gray-200 transition hover:bg-bg-soft lg:hidden"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
        <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
      </svg>
      {active && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg-card" />
      )}
    </button>
  );
}

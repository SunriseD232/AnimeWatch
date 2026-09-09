'use client';

import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import { hasAnyFilter } from '@/lib/catalogFilters';

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
      className="press relative -mr-1 shrink-0 p-1 text-white lg:hidden"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-6 w-6 fill-none stroke-current stroke-2">
        <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
      </svg>
      {/* Без кольца-обводки: у кнопки больше нет своей подложки, и кольцо
          цвета карточки читалось бы как случайное пятно на фоне страницы. */}
      {active && (
        <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-accent" />
      )}
    </button>
  );
}

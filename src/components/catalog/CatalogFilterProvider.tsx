'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  EMPTY_FILTERS,
  buildQuery,
  cycleTri,
  filtersEqual,
  hasAnyFilter,
  parseFilters,
  type AnimeCatalogFilters,
} from '@/lib/animeFilters';

/**
 * Общее черновое состояние всех фильтров каталога аниме.
 *
 * Зачем контекст, а не состояние внутри одной панели: фильтры теперь живут в
 * ДВУХ местах разметки — жанры сверху, остальные группы в левой колонке, — а
 * кнопка «Применить» должна быть одна на всех и применять их одним переходом.
 * Держать при этом два независимых черновика значило бы, что нажатие в
 * сайдбаре молча теряет невыпущенный выбор жанров (и наоборот).
 *
 * Применённое состояние по-прежнему живёт в адресной строке — черновик здесь
 * только до нажатия «Применить». Так сохраняется прежнее поведение каталога:
 * медленный запрос (AND/exclude по жанрам догружает полные карточки, см.
 * getAnimeCatalog) уходит один раз на весь набор, а не на каждый клик.
 */

interface CatalogFilterValue {
  /** Черновик — то, что пользователь накликал, но ещё не применил. */
  pending: AnimeCatalogFilters;
  /** Применённое состояние (из URL) — с ним сравнивается черновик. */
  applied: AnimeCatalogFilters;
  sort: string;
  showAnons: boolean;
  dirty: boolean;
  hasFilters: boolean;
  setPending: (next: AnimeCatalogFilters) => void;
  /** Переключить пункт трёхпозиционной группы: включить → исключить → снять. */
  toggle: (group: TriGroup, value: string) => void;
  setRange: (field: RangeField, value: number | null) => void;
  /** Применить черновик (переход по URL). Сортировка и «анонсы» — быстрые
   *  сами по себе, поэтому применяются сразу, но вместе с текущим черновиком,
   *  чтобы не терять его молча. */
  apply: (override?: { sort?: string; showAnons?: boolean }) => void;
  reset: () => void;
  /** Мобильная панель фильтров (CatalogMobileDrawer). Состояние здесь, а не
   *  в самой панели: открывает её кнопка-гамбургер из шапки — отдельный
   *  компонент, соседний, а не родительский. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** Десктопная панель фильтров. Состояние здесь, потому что от него зависит
   *  не только сама панель: при открытой панели сетка карточек переходит на
   *  более мелкие (см. CatalogArea и .catalog-grid в globals.css), а это уже
   *  соседняя ветка разметки. */
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
}

export type TriGroup = 'genres' | 'ratings' | 'kinds' | 'statuses';
export type RangeField = 'episodesFrom' | 'episodesTo' | 'yearFrom' | 'yearTo';

const Ctx = createContext<CatalogFilterValue | null>(null);

export function useCatalogFilters(): CatalogFilterValue {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error('useCatalogFilters вызван вне CatalogFilterProvider');
  }
  return value;
}

export default function CatalogFilterProvider({
  defaultSort,
  children,
}: {
  defaultSort: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  const applied = useMemo(() => parseFilters(searchParams), [searchParams]);
  const sort = searchParams.get('sort') ?? defaultSort;
  const showAnons = searchParams.get('anons') === '1';

  const [pending, setPending] = useState<AnimeCatalogFilters>(applied);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Подхватываем применённое состояние, когда URL изменился не нашей же
  // apply(): назад/вперёд в браузере, заход по ссылке с параметрами. После
  // собственной apply() значения уже совпадают и эффект ничего не меняет.
  useEffect(() => {
    setPending(parseFilters(new URLSearchParams(queryString)));
  }, [queryString]);

  const apply = useCallback(
    (override?: { sort?: string; showAnons?: boolean }) => {
      const qs = buildQuery(pending, {
        sort: override?.sort ?? sort,
        defaultSort,
        showAnons: override?.showAnons ?? showAnons,
        // Смена фильтров сбрасывает пагинацию: третьей страницы у нового
        // набора может не быть вовсе, и пользователь упёрся бы в «Дальше
        // ничего нет» вместо результатов.
        page: 1,
      });
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pending, sort, showAnons, defaultSort, pathname, router],
  );

  // Ключ здесь вычисляемый (group/field — объединения литералов), а spread с
  // таким ключом TypeScript расширяет до индексной сигнатуры и теряет тип
  // AnimeCatalogFilters. Поэтому присваивание через явную копию.
  const toggle = useCallback((group: TriGroup, value: string) => {
    setPending((prev) => {
      const next: AnimeCatalogFilters = { ...prev };
      next[group] = cycleTri(prev[group], value);
      return next;
    });
  }, []);

  const setRange = useCallback((field: RangeField, value: number | null) => {
    setPending((prev) => {
      const next: AnimeCatalogFilters = { ...prev };
      next[field] = value;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPending(EMPTY_FILTERS);
    const qs = buildQuery(EMPTY_FILTERS, { sort, defaultSort, showAnons, page: 1 });
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sort, defaultSort, showAnons, pathname, router]);

  const value = useMemo<CatalogFilterValue>(
    () => ({
      pending,
      applied,
      sort,
      showAnons,
      dirty: !filtersEqual(pending, applied),
      hasFilters: hasAnyFilter(pending),
      setPending,
      toggle,
      setRange,
      apply,
      reset,
      drawerOpen,
      setDrawerOpen,
      filtersOpen,
      setFiltersOpen,
    }),
    [
      pending,
      applied,
      sort,
      showAnons,
      toggle,
      setRange,
      apply,
      reset,
      drawerOpen,
      filtersOpen,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <ApplyBar />
    </Ctx.Provider>
  );
}

/** Одна кнопка «Применить» на все группы фильтров сразу. Липкая снизу —
 *  список фильтров в сайдбаре длинный, и кнопка у его конца была бы за
 *  пределами экрана в момент, когда пользователь закончил выбирать.
 *
 *  Только для десктопа (lg:). На телефоне все контролы живут в выезжающей
 *  панели, и своя кнопка «Применить» есть у неё — две сразу спорили бы за
 *  один и тот же низ экрана. */
function ApplyBar() {
  const { dirty, apply } = useCatalogFilters();
  if (!dirty) return null;

  return (
    <div className="pointer-events-none sticky bottom-4 z-10 hidden items-center justify-center lg:flex">
      <button
        type="button"
        onClick={() => apply()}
        className="press animate-rise pointer-events-auto rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/40 transition hover:bg-accent-hover"
      >
        Применить
      </button>
    </div>
  );
}

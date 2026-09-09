'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  COMMON_PARAM,
  buildQuery,
  cycleTri,
  emptyFilters,
  filtersEqual,
  hasAnyFilter,
  parseFilters,
  type CatalogFilterConfig,
  type CatalogFilters,
} from '@/lib/catalogFilters';

/**
 * Общее черновое состояние всех фильтров каталога — и аниме, и кино.
 *
 * Зачем контекст, а не состояние внутри одной панели: фильтры живут в ДВУХ
 * местах разметки — колонка на десктопе и выезжающая шторка на телефоне, — а
 * кнопка «Применить» должна быть одна на всех и применять их одним переходом.
 * Держать при этом два независимых черновика значило бы, что нажатие в одном
 * месте молча теряет невыпущенный выбор в другом.
 *
 * Применённое состояние живёт в адресной строке — черновик здесь только до
 * нажатия «Применить»: так тяжёлый запрос уходит один раз на весь набор, а не
 * на каждый клик.
 *
 * Какие вообще есть группы, знает не провайдер, а конфиг (lib/animeFilters.ts,
 * lib/cinemaFilters.ts). Провайдер и панель работают с ним как с данными —
 * поэтому один и тот же интерфейс обслуживает два разных каталога.
 */

interface CatalogFilterValue {
  /** Описание групп: что рисовать и как это называется в URL. */
  config: CatalogFilterConfig;
  /** Черновик — то, что пользователь накликал, но ещё не применил. */
  pending: CatalogFilters;
  /** Применённое состояние (из URL) — с ним сравнивается черновик. */
  applied: CatalogFilters;
  sort: string;
  showAnons: boolean;
  dirty: boolean;
  hasFilters: boolean;
  setPending: (next: CatalogFilters) => void;
  /** Переключить пункт группы: включить → исключить → снять. */
  toggle: (group: string, value: string) => void;
  setRange: (field: string, value: number | null) => void;
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
   *  не только сама панель: при открытой панели сетка карточек ужимается
   *  (см. CatalogArea и .catalog-grid в globals.css), а это уже соседняя
   *  ветка разметки. */
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
}

const Ctx = createContext<CatalogFilterValue | null>(null);

export function useCatalogFilters(): CatalogFilterValue {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error('useCatalogFilters вызван вне CatalogFilterProvider');
  }
  return value;
}

export default function CatalogFilterProvider({
  config,
  children,
}: {
  config: CatalogFilterConfig;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  const applied = useMemo(() => parseFilters(searchParams, config), [searchParams, config]);
  const sort = searchParams.get(COMMON_PARAM.sort) ?? config.defaultSort;
  const showAnons = searchParams.get(COMMON_PARAM.anons) === '1';

  const [pending, setPending] = useState<CatalogFilters>(applied);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Подхватываем применённое состояние, когда URL изменился не нашей же
  // apply(): назад/вперёд в браузере, заход по ссылке с параметрами. После
  // собственной apply() значения уже совпадают и эффект ничего не меняет.
  useEffect(() => {
    setPending(parseFilters(new URLSearchParams(queryString), config));
  }, [queryString, config]);

  const apply = useCallback(
    (override?: { sort?: string; showAnons?: boolean }) => {
      const qs = buildQuery(pending, config, {
        sort: override?.sort ?? sort,
        showAnons: override?.showAnons ?? showAnons,
        // Смена фильтров сбрасывает пагинацию: третьей страницы у нового
        // набора может не быть вовсе, и пользователь упёрся бы в «Дальше
        // ничего нет» вместо результатов.
        page: 1,
      });
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pending, sort, showAnons, config, pathname, router],
  );

  const toggle = useCallback((group: string, value: string) => {
    setPending((prev) => ({
      ...prev,
      tri: { ...prev.tri, [group]: cycleTri(prev.tri[group] ?? { include: [], exclude: [] }, value) },
    }));
  }, []);

  const setRange = useCallback((field: string, value: number | null) => {
    setPending((prev) => ({ ...prev, range: { ...prev.range, [field]: value } }));
  }, []);

  const reset = useCallback(() => {
    const empty = emptyFilters(config);
    setPending(empty);
    const qs = buildQuery(empty, config, { sort, showAnons, page: 1 });
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sort, showAnons, config, pathname, router]);

  const value = useMemo<CatalogFilterValue>(
    () => ({
      config,
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
      config,
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
 *  список фильтров в колонке длинный, и кнопка у его конца была бы за
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

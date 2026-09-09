/**
 * Общая модель фильтров каталога — одна на аниме и на кино.
 *
 * Раньше эта модель была написана прямо под аниме (lib/animeFilters.ts), и
 * панель фильтров знала про episodesFrom и статусы поимённо. Когда такой же
 * фильтр понадобился кино, выбор был между копией всей панели со всеми её
 * анимациями и липкими колонками — и описанием групп данными. Здесь второе:
 * набор групп задаётся конфигом (см. animeFilters.ts и cinemaFilters.ts), а
 * компоненты рисуют то, что в конфиге, ничего не зная про предметную область.
 *
 * Применённое состояние живёт в адресной строке — это бесплатно даёт
 * «фильтры сохраняются при возврате назад» обычной навигацией браузера и
 * делимые ссылки.
 */

/** Трёхпозиционный выбор: включить / исключить / не трогать. Исключение —
 *  второе нажатие по тому же пункту. */
export interface TriState {
  include: string[];
  exclude: string[];
}

export const EMPTY_TRI: TriState = { include: [], exclude: [] };

export interface FilterOptionDef {
  value: string;
  label: string;
}

/**
 * Состояние всех фильтров. Плоские Record'ы, а не именованные поля, именно
 * для того, чтобы панель могла обойти их циклом по конфигу.
 */
export interface CatalogFilters {
  /** Трёхпозиционные группы по ключу группы: жанры, тип, страна, статус… */
  tri: Record<string, TriState>;
  /** Числовые поля диапазонов по имени поля: yearFrom, episodesTo… */
  range: Record<string, number | null>;
}

/**
 * Как рисовать группу:
 *  - 'checkboxes' — обычный столбик чекбоксов (тип, статус, рейтинг);
 *  - 'list'       — прокручиваемый список (жанры, страны): пунктов десятки
 *                   или сотни, и столбиком они заняли бы несколько экранов.
 */
export type TriGroupLayout = 'checkboxes' | 'list';

export interface TriGroupDef {
  key: string;
  title: string;
  param: string;
  paramExclude: string;
  layout: TriGroupLayout;
  /**
   * Готовый список пунктов. Если его нет — список динамический (жанры и
   * страны приходят из индекса) и передаётся в панель пропом `options`.
   */
  options?: FilterOptionDef[];
  /** Что подставить, когда пользователь не выбрал ничего. */
  defaultInclude?: string[];
  /**
   * Значения — числовые id из индекса. Проверять их по списку допустимых при
   * разборе URL нечем (список приходит из базы), поэтому проверка сводится к
   * «это положительное число».
   */
  numeric?: boolean;
}

export interface RangeGroupDef {
  key: string;
  title: string;
  fromField: string;
  toField: string;
  fromParam: string;
  toParam: string;
  min: number;
  max: number;
  fromPlaceholder: string;
  toPlaceholder: string;
}

export interface CatalogFilterConfig {
  /** Порядок групп в панели — порядок в этом массиве. */
  tri: TriGroupDef[];
  /** Диапазоны идут после трёхпозиционных групп: это единственные поля с
   *  вводом, остальное выбирается мышью. */
  ranges: RangeGroupDef[];
  sorts: readonly FilterOptionDef[];
  defaultSort: string;
  /** Галка «Показывать анонсы» — только у аниме. */
  showAnonsToggle?: boolean;
  /** Переключатель плитки/список — только у аниме: у кино нет строчной
   *  карточки. */
  showViewSwitch?: boolean;
}

/** Имена общих query-параметров. */
export const COMMON_PARAM = {
  sort: 'sort',
  page: 'page',
  anons: 'anons',
  view: 'view',
} as const;

/** Вид выдачи каталога. В URL, а не в localStorage: страницу рендерит
 *  сервер, и он должен знать вид ещё до отдачи разметки — иначе список
 *  сначала мелькнёт плитками. Заодно ссылка остаётся делимой. */
export type CatalogView = 'grid' | 'list';

export const DEFAULT_VIEW: CatalogView = 'grid';

export function parseView(value: string | null | undefined): CatalogView {
  return value === 'list' ? 'list' : 'grid';
}

type Params = Pick<URLSearchParams, 'get'>;

function splitList(value: string | null | undefined): string[] {
  return (value ?? '').split(',').filter(Boolean);
}

/**
 * Отбрасывает всё, чего нет в списке допустимых значений — параметры
 * приходят из адресной строки, то есть от кого угодно, и уезжают дальше в
 * SQL-запрос к индексу или в запрос к чужому API.
 */
function keepValid(values: string[], group: TriGroupDef): string[] {
  if (group.numeric) {
    return values.filter((v) => /^\d+$/.test(v) && Number(v) > 0);
  }
  if (!group.options) return [];
  return values.filter((v) => group.options!.some((o) => o.value === v));
}

function readInt(params: Params, key: string, min: number, max: number): number | null {
  const raw = Number(params.get(key));
  if (!Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return n >= min && n <= max ? n : null;
}

/** Перевёрнутый диапазон («от 20 до 5») трактуем как перепутанные местами,
 *  а не как «ничего не найдено» — так ведёт себя большинство фильтров. */
function swapIfInverted(from: number | null, to: number | null): [number | null, number | null] {
  if (from !== null && to !== null && from > to) return [to, from];
  return [from, to];
}

export function emptyFilters(config: CatalogFilterConfig): CatalogFilters {
  const tri: Record<string, TriState> = {};
  for (const g of config.tri) tri[g.key] = EMPTY_TRI;

  const range: Record<string, number | null> = {};
  for (const r of config.ranges) {
    range[r.fromField] = null;
    range[r.toField] = null;
  }

  return { tri, range };
}

/** Разбирает фильтры из searchParams. Мусор молча игнорируется: сломанная
 *  ссылка должна открыть каталог, а не страницу ошибки. */
export function parseFilters(params: Params, config: CatalogFilterConfig): CatalogFilters {
  const tri: Record<string, TriState> = {};
  for (const g of config.tri) {
    tri[g.key] = {
      include: keepValid(splitList(params.get(g.param)), g),
      exclude: keepValid(splitList(params.get(g.paramExclude)), g),
    };
  }

  const range: Record<string, number | null> = {};
  for (const r of config.ranges) {
    const from = readInt(params, r.fromParam, r.min, r.max);
    const to = readInt(params, r.toParam, r.min, r.max);
    const [a, b] = swapIfInverted(from, to);
    range[r.fromField] = a;
    range[r.toField] = b;
  }

  return { tri, range };
}

/** Собирает query-строку. Пустые значения не пишем — короткий URL читаемее и
 *  лучше кэшируется. */
export function buildQuery(
  filters: CatalogFilters,
  config: CatalogFilterConfig,
  extra: {
    sort?: string;
    page?: number;
    showAnons?: boolean;
    view?: CatalogView;
  },
): string {
  const params = new URLSearchParams();

  for (const g of config.tri) {
    const state = filters.tri[g.key] ?? EMPTY_TRI;
    if (state.include.length > 0) params.set(g.param, state.include.join(','));
    if (state.exclude.length > 0) params.set(g.paramExclude, state.exclude.join(','));
  }

  for (const r of config.ranges) {
    const from = filters.range[r.fromField];
    const to = filters.range[r.toField];
    if (from != null) params.set(r.fromParam, String(from));
    if (to != null) params.set(r.toParam, String(to));
  }

  if (extra.sort && extra.sort !== config.defaultSort) params.set(COMMON_PARAM.sort, extra.sort);
  if (extra.view && extra.view !== DEFAULT_VIEW) params.set(COMMON_PARAM.view, extra.view);
  if (extra.showAnons) params.set(COMMON_PARAM.anons, '1');
  if (extra.page && extra.page > 1) params.set(COMMON_PARAM.page, String(extra.page));

  return params.toString();
}

/** Есть ли вообще что сбрасывать. */
export function hasAnyFilter(f: CatalogFilters): boolean {
  for (const state of Object.values(f.tri)) {
    if (state.include.length > 0 || state.exclude.length > 0) return true;
  }
  for (const value of Object.values(f.range)) {
    if (value != null) return true;
  }
  return false;
}

/** Сравнение для «есть несохранённые изменения» — фильтры плоские и мелкие,
 *  сериализация тут дешевле и надёжнее ручного обхода полей. */
export function filtersEqual(a: CatalogFilters, b: CatalogFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Следующее состояние пункта по клику: нейтрально → включить → исключить →
 *  нейтрально. */
export function cycleTri(state: TriState, value: string): TriState {
  if (state.include.includes(value)) {
    return {
      include: state.include.filter((v) => v !== value),
      exclude: [...state.exclude, value],
    };
  }
  if (state.exclude.includes(value)) {
    return { include: state.include, exclude: state.exclude.filter((v) => v !== value) };
  }
  return { include: [...state.include, value], exclude: state.exclude };
}

/** Сколько пунктов выбрано в группе — для бейджа у свёрнутой секции. */
export function groupCount(filters: CatalogFilters, key: string): number {
  const state = filters.tri[key];
  if (!state) return 0;
  return state.include.length + state.exclude.length;
}

/** Числовые id выбранной группы — в таком виде их ждёт запрос к индексу. */
export function triIds(filters: CatalogFilters, key: string): { include: number[]; exclude: number[] } {
  const state = filters.tri[key] ?? EMPTY_TRI;
  const toNums = (values: string[]) =>
    values.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
  return { include: toNums(state.include), exclude: toNums(state.exclude) };
}

/** Значения группы как есть (строковые коды: kind, status, rating). */
export function triValues(filters: CatalogFilters, key: string): TriState {
  return filters.tri[key] ?? EMPTY_TRI;
}

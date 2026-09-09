/**
 * Фильтры каталога аниме: наборы значений, разбор и сборка URL.
 *
 * Общий модуль для сервера (app/catalog/page.tsx — читает searchParams и
 * ходит в Shikimori) и клиента (components/catalog/* — рисует панель). Держим
 * в одном месте, чтобы имена query-параметров и допустимые значения не
 * разъезжались между двумя сторонами.
 *
 * Применённое состояние живёт в адресной строке (как и раньше у жанров) —
 * это бесплатно даёт «фильтры сохраняются при возврате назад» обычной
 * навигацией браузера и делимые ссылки.
 */

/** Трёхпозиционный выбор: включить / исключить / не трогать. Исключение —
 *  второе нажатие по тому же пункту, как у жанров. */
export interface TriState {
  include: string[];
  exclude: string[];
}

export const EMPTY_TRI: TriState = { include: [], exclude: [] };

export interface FilterOptionDef {
  value: string;
  label: string;
}

/** Возрастной рейтинг. Значения — как их принимает Shikimori (`rating=`).
 *  `g` и `none` намеренно не выносим: в каталоге они шума дают больше, чем
 *  пользы, и пользователь их не просил. */
export const RATING_OPTIONS: FilterOptionDef[] = [
  { value: 'pg', label: 'PG' },
  { value: 'pg_13', label: 'PG-13' },
  { value: 'r', label: 'R-17' },
  { value: 'r_plus', label: 'R+' },
  { value: 'rx', label: 'RX (18+)' },
];

/** Тип тайтла (`kind=` у Shikimori).
 *
 * ВНИМАНИЕ по «Короткометражке»: у Shikimori такого типа нет. Его девять
 * значений — tv, movie, ova, ona, special, tv_special, music, pv, cm. Шесть
 * пунктов ниже ложатся на них один в один, а «Короткометражка» отображена на
 * оставшийся `tv_special` (у самого Shikimori он подписан «TV Спешл»). Это
 * единственное неточное соответствие во всём наборе — если имелась в виду
 * именно короткая длительность, у API есть отдельный параметр
 * `duration=S` (менее 10 минут), и пункт нужно переносить на него. */
export const KIND_OPTIONS: FilterOptionDef[] = [
  { value: 'tv', label: 'TV' },
  { value: 'ona', label: 'ONA' },
  { value: 'ova', label: 'OVA' },
  { value: 'movie', label: 'Фильм' },
  { value: 'special', label: 'Спешл' },
  { value: 'tv_special', label: 'Короткометражка' },
  { value: 'music', label: 'Клип' },
];

/** Статус тайтла (`status=` у Shikimori). */
export const STATUS_OPTIONS: FilterOptionDef[] = [
  { value: 'ongoing', label: 'Онгоинг' },
  { value: 'released', label: 'Завершён' },
  { value: 'anons', label: 'Анонс' },
];

/** Типы по умолчанию, когда пользователь ничего не выбрал — прежнее
 *  поведение каталога (в нём никогда не было спешлов и клипов). */
export const DEFAULT_KINDS = ['tv', 'movie', 'ona'];

/** Разумные границы года. Нижняя — примерно начало того, что вообще есть в
 *  базе; верхняя — с запасом на анонсы будущих сезонов. */
export const MIN_YEAR = 1960;
export const MAX_YEAR = new Date().getFullYear() + 2;

/** Имена query-параметров. В одном месте, чтобы опечатка не превращалась в
 *  молча игнорируемый фильтр. */
export const PARAM = {
  genres: 'genres',
  genresExclude: 'exclude',
  episodesFrom: 'ep_from',
  episodesTo: 'ep_to',
  yearFrom: 'year_from',
  yearTo: 'year_to',
  rating: 'rating',
  ratingExclude: 'rating_ex',
  kind: 'kind',
  kindExclude: 'kind_ex',
  status: 'status',
  statusExclude: 'status_ex',
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

export interface AnimeCatalogFilters {
  genres: TriState;
  episodesFrom: number | null;
  episodesTo: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  ratings: TriState;
  kinds: TriState;
  statuses: TriState;
}

export const EMPTY_FILTERS: AnimeCatalogFilters = {
  genres: EMPTY_TRI,
  episodesFrom: null,
  episodesTo: null,
  yearFrom: null,
  yearTo: null,
  ratings: EMPTY_TRI,
  kinds: EMPTY_TRI,
  statuses: EMPTY_TRI,
};

type Params = Pick<URLSearchParams, 'get'>;

function splitList(value: string | null | undefined): string[] {
  return (value ?? '').split(',').filter(Boolean);
}

/** Отбрасывает всё, чего нет в списке допустимых значений — параметры
 *  приходят из адресной строки, то есть от кого угодно, и уезжают дальше в
 *  запрос к Shikimori. */
function keepKnown(values: string[], allowed: FilterOptionDef[]): string[] {
  return values.filter((v) => allowed.some((o) => o.value === v));
}

function readTri(params: Params, incKey: string, excKey: string, allowed: FilterOptionDef[]): TriState {
  return {
    include: keepKnown(splitList(params.get(incKey)), allowed),
    exclude: keepKnown(splitList(params.get(excKey)), allowed),
  };
}

function readInt(params: Params, key: string, min: number, max: number): number | null {
  const raw = Number(params.get(key));
  if (!Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return n >= min && n <= max ? n : null;
}

export function parseNumericIds(value: string | null | undefined): number[] {
  return splitList(value)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Разбирает фильтры из searchParams. Мусор молча игнорируется: сломанная
 *  ссылка должна открыть каталог, а не страницу ошибки. */
export function parseFilters(params: Params): AnimeCatalogFilters {
  const episodesFrom = readInt(params, PARAM.episodesFrom, 1, 100000);
  const episodesTo = readInt(params, PARAM.episodesTo, 1, 100000);
  const yearFrom = readInt(params, PARAM.yearFrom, MIN_YEAR, MAX_YEAR);
  const yearTo = readInt(params, PARAM.yearTo, MIN_YEAR, MAX_YEAR);

  return {
    genres: {
      include: splitList(params.get(PARAM.genres)),
      exclude: splitList(params.get(PARAM.genresExclude)),
    },
    // Перевёрнутый диапазон («от 20 до 5») трактуем как перепутанные местами,
    // а не как «ничего не найдено» — так ведёт себя большинство фильтров.
    episodesFrom: swapIfInverted(episodesFrom, episodesTo)[0],
    episodesTo: swapIfInverted(episodesFrom, episodesTo)[1],
    yearFrom: swapIfInverted(yearFrom, yearTo)[0],
    yearTo: swapIfInverted(yearFrom, yearTo)[1],
    ratings: readTri(params, PARAM.rating, PARAM.ratingExclude, RATING_OPTIONS),
    kinds: readTri(params, PARAM.kind, PARAM.kindExclude, KIND_OPTIONS),
    statuses: readTri(params, PARAM.status, PARAM.statusExclude, STATUS_OPTIONS),
  };
}

function swapIfInverted(from: number | null, to: number | null): [number | null, number | null] {
  if (from !== null && to !== null && from > to) return [to, from];
  return [from, to];
}

/** Собирает query-строку. Пустые значения не пишем — короткий URL читаемее и
 *  лучше кэшируется. */
export function buildQuery(
  filters: AnimeCatalogFilters,
  extra: {
    sort?: string;
    defaultSort?: string;
    page?: number;
    showAnons?: boolean;
    view?: CatalogView;
  },
): string {
  const params = new URLSearchParams();
  const setList = (key: string, values: string[]) => {
    if (values.length > 0) params.set(key, values.join(','));
  };
  const setNum = (key: string, value: number | null) => {
    if (value !== null) params.set(key, String(value));
  };

  setList(PARAM.genres, filters.genres.include);
  setList(PARAM.genresExclude, filters.genres.exclude);
  setNum(PARAM.episodesFrom, filters.episodesFrom);
  setNum(PARAM.episodesTo, filters.episodesTo);
  setNum(PARAM.yearFrom, filters.yearFrom);
  setNum(PARAM.yearTo, filters.yearTo);
  setList(PARAM.rating, filters.ratings.include);
  setList(PARAM.ratingExclude, filters.ratings.exclude);
  setList(PARAM.kind, filters.kinds.include);
  setList(PARAM.kindExclude, filters.kinds.exclude);
  setList(PARAM.status, filters.statuses.include);
  setList(PARAM.statusExclude, filters.statuses.exclude);

  if (extra.sort && extra.sort !== extra.defaultSort) params.set(PARAM.sort, extra.sort);
  if (extra.view && extra.view !== DEFAULT_VIEW) params.set(PARAM.view, extra.view);
  if (extra.showAnons) params.set(PARAM.anons, '1');
  if (extra.page && extra.page > 1) params.set(PARAM.page, String(extra.page));

  return params.toString();
}

/** Есть ли вообще что сбрасывать. */
export function hasAnyFilter(f: AnimeCatalogFilters): boolean {
  const triFilled = (t: TriState) => t.include.length > 0 || t.exclude.length > 0;
  return (
    triFilled(f.genres) ||
    triFilled(f.ratings) ||
    triFilled(f.kinds) ||
    triFilled(f.statuses) ||
    f.episodesFrom !== null ||
    f.episodesTo !== null ||
    f.yearFrom !== null ||
    f.yearTo !== null
  );
}

/** Сравнение для «есть несохранённые изменения» — фильтры плоские и мелкие,
 *  сериализация тут дешевле и надёжнее ручного обхода полей. */
export function filtersEqual(a: AnimeCatalogFilters, b: AnimeCatalogFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Следующее состояние пункта по клику: нейтрально → включить → исключить →
 *  нейтрально. Ровно та же механика, что у жанров. */
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

/**
 * Конфиг фильтров каталога аниме поверх общей модели (lib/catalogFilters.ts).
 *
 * Здесь только предметная область: какие группы есть, какими значениями они
 * оперируют и как называются в URL. Разбор, сборка и вся механика — общие,
 * ими же живёт каталог кино (lib/cinemaFilters.ts).
 */

import type { CatalogFilterConfig, FilterOptionDef } from '@/lib/catalogFilters';

export type {
  CatalogFilters,
  CatalogView,
  FilterOptionDef,
  TriState,
} from '@/lib/catalogFilters';
export {
  DEFAULT_VIEW,
  EMPTY_TRI,
  buildQuery,
  cycleTri,
  emptyFilters,
  filtersEqual,
  groupCount,
  hasAnyFilter,
  parseFilters,
  parseView,
  triIds,
  triValues,
} from '@/lib/catalogFilters';

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

export const ANIME_SORTS: readonly FilterOptionDef[] = [
  { value: 'aired_on', label: 'Сначала новые' },
  { value: 'ranked', label: 'По рейтингу' },
  { value: 'popularity', label: 'По популярности' },
  { value: 'name', label: 'По алфавиту' },
];

export const ANIME_DEFAULT_SORT = 'aired_on';

/**
 * Порядок групп = порядок в панели. Жанры первыми (ими пользуются чаще
 * всего), возрастной рейтинг последним из чекбоксов, диапазоны в самом
 * конце — это единственные поля с вводом.
 */
export const ANIME_FILTER_CONFIG: CatalogFilterConfig = {
  tri: [
    {
      key: 'genres',
      title: 'Жанры',
      param: PARAM.genres,
      paramExclude: PARAM.genresExclude,
      layout: 'list',
      numeric: true,
    },
    {
      key: 'kinds',
      title: 'Тип',
      param: PARAM.kind,
      paramExclude: PARAM.kindExclude,
      layout: 'checkboxes',
      options: KIND_OPTIONS,
      defaultInclude: DEFAULT_KINDS,
    },
    {
      key: 'statuses',
      title: 'Статус тайтла',
      param: PARAM.status,
      paramExclude: PARAM.statusExclude,
      layout: 'checkboxes',
      options: STATUS_OPTIONS,
    },
    {
      key: 'ratings',
      title: 'Возрастной рейтинг',
      param: PARAM.rating,
      paramExclude: PARAM.ratingExclude,
      layout: 'checkboxes',
      options: RATING_OPTIONS,
    },
  ],
  ranges: [
    {
      key: 'episodes',
      title: 'Количество эпизодов',
      fromField: 'episodesFrom',
      toField: 'episodesTo',
      fromParam: PARAM.episodesFrom,
      toParam: PARAM.episodesTo,
      min: 1,
      max: 100000,
      fromPlaceholder: 'от',
      toPlaceholder: 'до',
    },
    {
      key: 'year',
      title: 'Год релиза',
      fromField: 'yearFrom',
      toField: 'yearTo',
      fromParam: PARAM.yearFrom,
      toParam: PARAM.yearTo,
      min: MIN_YEAR,
      max: MAX_YEAR,
      fromPlaceholder: String(MIN_YEAR),
      toPlaceholder: String(MAX_YEAR),
    },
  ],
  sorts: ANIME_SORTS,
  defaultSort: ANIME_DEFAULT_SORT,
  showAnonsToggle: true,
  showViewSwitch: true,
};

export function parseNumericIds(value: string | null | undefined): number[] {
  return (value ?? '')
    .split(',')
    .filter(Boolean)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

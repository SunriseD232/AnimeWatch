/**
 * Конфиг фильтров каталога кино поверх общей модели (lib/catalogFilters.ts).
 *
 * Набор групп и вся механика совпадают с аниме — так и задумано: панель одна
 * и та же, отличается только содержимое конфига.
 */

import type { CatalogFilterConfig, FilterOptionDef } from '@/lib/catalogFilters';

/**
 * Тип контента. У Videoseed своего поля с такой детализацией нет — только
 * movie/serial, — мультфильмы и короткометражки достраиваются при
 * индексации по жанрам-маркерам (см. deriveKind в lib/cinemaIndex.ts).
 */
export const CINEMA_KIND_OPTIONS: FilterOptionDef[] = [
  { value: 'serial', label: 'Сериал' },
  { value: 'movie', label: 'Фильм' },
  { value: 'cartoon_serial', label: 'Мультсериал' },
  { value: 'cartoon', label: 'Мультфильм' },
  { value: 'short', label: 'Короткометражка' },
];

/**
 * Подпись типа для карточки. Тот же набор слов, что и в фильтре: карточка
 * подписана «Мультсериал» — значит и галка в фильтре называется так же.
 *
 * Нужна отдельно от кода, потому что в CinemaShort.kind исторически лежит
 * ГОТОВАЯ подпись, а не код (см. lib/videoseed-catalog.ts): карточка выводит
 * это поле как есть. Без перевода в каталоге появлялось «movie · 2022».
 */
export function cinemaKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return CINEMA_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? null;
}

/** Нижняя граница — примерно начало того, что есть в базе (самый ранний
 *  фильм 1900-х), верхняя — с запасом на анонсы. */
export const CINEMA_MIN_YEAR = 1900;
export const CINEMA_MAX_YEAR = new Date().getFullYear() + 2;

export const CINEMA_PARAM = {
  genres: 'genres',
  genresExclude: 'exclude',
  kind: 'kind',
  kindExclude: 'kind_ex',
  country: 'country',
  countryExclude: 'country_ex',
  yearFrom: 'year_from',
  yearTo: 'year_to',
  sort: 'sort',
  page: 'page',
} as const;

/**
 * Сортировки. Все четыре работают по ВСЕЙ базе — до индекса это было
 * невозможно в принципе: Videoseed сортировать не умеет, и прежний каталог
 * переставлял пул из 120 записей, набранный по порядку выдачи апстрима.
 */
export const CINEMA_SORTS: readonly FilterOptionDef[] = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'last_episode', label: 'По дате последней серии' },
  { value: 'rating', label: 'По рейтингу' },
  { value: 'name', label: 'По алфавиту' },
];

export const CINEMA_DEFAULT_SORT = 'new';

export type CinemaSort = 'new' | 'last_episode' | 'rating' | 'name';

export function parseCinemaSort(value: string | null | undefined): CinemaSort {
  return CINEMA_SORTS.some((s) => s.value === value) ? (value as CinemaSort) : 'new';
}

/**
 * Порядок групп = порядок в панели: жанры, тип, страна, год. Ровно как в
 * каталоге аниме — сперва то, чем пользуются чаще, поле с вводом последним.
 */
export const CINEMA_FILTER_CONFIG: CatalogFilterConfig = {
  tri: [
    {
      key: 'genres',
      title: 'Жанры',
      param: CINEMA_PARAM.genres,
      paramExclude: CINEMA_PARAM.genresExclude,
      layout: 'list',
      numeric: true,
    },
    {
      key: 'kinds',
      title: 'Тип',
      param: CINEMA_PARAM.kind,
      paramExclude: CINEMA_PARAM.kindExclude,
      layout: 'checkboxes',
      options: CINEMA_KIND_OPTIONS,
    },
    {
      // Стран в базе около 150, поэтому список, а не чекбоксы — столбиком
      // они заняли бы несколько экранов. Тот же контрол, что у жанров.
      key: 'countries',
      title: 'Страна',
      param: CINEMA_PARAM.country,
      paramExclude: CINEMA_PARAM.countryExclude,
      layout: 'list',
      numeric: true,
    },
  ],
  ranges: [
    {
      key: 'year',
      title: 'Год',
      fromField: 'yearFrom',
      toField: 'yearTo',
      fromParam: CINEMA_PARAM.yearFrom,
      toParam: CINEMA_PARAM.yearTo,
      min: CINEMA_MIN_YEAR,
      max: CINEMA_MAX_YEAR,
      fromPlaceholder: String(CINEMA_MIN_YEAR),
      toPlaceholder: String(CINEMA_MAX_YEAR),
    },
  ],
  sorts: CINEMA_SORTS,
  defaultSort: CINEMA_DEFAULT_SORT,
};

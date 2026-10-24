/**
 * Конфиги фильтров каталогов чтения (/manga/catalog, /ranobe/catalog,
 * /books/catalog) поверх общей модели (lib/catalogFilters.ts) — та же
 * панель, что у аниме и кино, отличается только конфиг.
 *
 * Модуль общий для сервера и браузера (панель строит по нему ссылки), поэтому
 * без серверных зависимостей. Запрос к индексу — lib/readingCatalog.ts.
 */

import type { CatalogFilterConfig, FilterOptionDef } from '@/lib/catalogFilters';

/** Каталоги с общим каркасом: три раздела чтения и аудиокниги (0064). */
export type ReadingKind = 'manga' | 'ranobe' | 'books' | 'audiobooks';

export const READING_PARAM = {
  genres: 'genres',
  genresExclude: 'genres_ex',
  tags: 'tags',
  tagsExclude: 'tags_ex',
  kind: 'kind',
  kindExclude: 'kind_ex',
  status: 'status',
  statusExclude: 'status_ex',
  yearFrom: 'year_from',
  yearTo: 'year_to',
  ratingFrom: 'rating_from',
  ratingTo: 'rating_to',
  chaptersFrom: 'chapters_from',
  chaptersTo: 'chapters_to',
  hoursFrom: 'hours_from',
  hoursTo: 'hours_to',
  availability: 'avail',
  availabilityExclude: 'avail_ex',
} as const;

/**
 * Сортировки. Ключи совпадают со значками SortSelect там, где смысл тот же
 * (popularity, rating, new, name); «Сначала старые» и «По числу глав» —
 * без значка.
 */
const TITLE_SORTS: readonly FilterOptionDef[] = [
  { value: 'popularity', label: 'По популярности' },
  { value: 'rating', label: 'По рейтингу' },
  { value: 'new', label: 'Сначала новые' },
  { value: 'old', label: 'Сначала старые' },
  { value: 'chapters', label: 'По числу глав' },
  { value: 'name', label: 'По алфавиту' },
];

/** У книг нет рейтинга (Флибуста его не ведёт) — популярность по скачиваниям;
 *  «Недавно добавленные» — по id Флибусты, он растёт с каждой новой книгой. */
const BOOK_SORTS: readonly FilterOptionDef[] = [
  { value: 'popularity', label: 'По популярности' },
  { value: 'new', label: 'Сначала новые' },
  { value: 'old', label: 'Сначала старые' },
  { value: 'added', label: 'Недавно добавленные' },
  { value: 'name', label: 'По алфавиту' },
];

/** Аудиокниги: рейтинга у knigavuhe нет, года издания тоже — популярность
 *  по прослушиваниям, «недавно добавленные» по id (растёт с каждой новой
 *  книгой), длительность — чтобы найти короткое на вечер или длинное. */
const AUDIOBOOK_SORTS: readonly FilterOptionDef[] = [
  { value: 'popularity', label: 'По популярности' },
  { value: 'added', label: 'Недавно добавленные' },
  { value: 'longest', label: 'Сначала длинные' },
  { value: 'shortest', label: 'Сначала короткие' },
  { value: 'name', label: 'По алфавиту' },
];

export type ReadingSort =
  | 'popularity'
  | 'rating'
  | 'new'
  | 'old'
  | 'chapters'
  | 'added'
  | 'longest'
  | 'shortest'
  | 'name';

export const READING_DEFAULT_SORT: ReadingSort = 'popularity';

export const READING_MIN_YEAR = 1900;
export const READING_MAX_YEAR = new Date().getFullYear() + 1;

const YEAR_RANGE = {
  key: 'year',
  title: 'Год выпуска',
  fromField: 'yearFrom',
  toField: 'yearTo',
  fromParam: READING_PARAM.yearFrom,
  toParam: READING_PARAM.yearTo,
  min: READING_MIN_YEAR,
  max: READING_MAX_YEAR,
  fromPlaceholder: 'с',
  toPlaceholder: 'по',
};

function titleConfig(kindTitle: string): CatalogFilterConfig {
  return {
    tri: [
      {
        key: 'genres',
        title: 'Жанры',
        param: READING_PARAM.genres,
        paramExclude: READING_PARAM.genresExclude,
        layout: 'list',
        names: true,
        searchable: true,
      },
      {
        key: 'tags',
        title: 'Теги',
        param: READING_PARAM.tags,
        paramExclude: READING_PARAM.tagsExclude,
        layout: 'list',
        names: true,
        searchable: true,
      },
      {
        key: 'kinds',
        title: kindTitle,
        param: READING_PARAM.kind,
        paramExclude: READING_PARAM.kindExclude,
        layout: 'checkboxes',
        names: true,
      },
      {
        key: 'statuses',
        title: 'Статус',
        param: READING_PARAM.status,
        paramExclude: READING_PARAM.statusExclude,
        layout: 'checkboxes',
        names: true,
      },
    ],
    ranges: [
      YEAR_RANGE,
      {
        key: 'rating',
        title: 'Рейтинг',
        fromField: 'ratingFrom',
        toField: 'ratingTo',
        fromParam: READING_PARAM.ratingFrom,
        toParam: READING_PARAM.ratingTo,
        min: 0,
        max: 10,
        fromPlaceholder: 'от 0',
        toPlaceholder: 'до 10',
      },
      {
        key: 'chapters',
        title: 'Число глав',
        fromField: 'chaptersFrom',
        toField: 'chaptersTo',
        fromParam: READING_PARAM.chaptersFrom,
        toParam: READING_PARAM.chaptersTo,
        min: 0,
        max: 100_000,
        fromPlaceholder: 'от',
        toPlaceholder: 'до',
      },
    ],
    sorts: TITLE_SORTS,
    defaultSort: READING_DEFAULT_SORT,
  };
}

export const READING_FILTER_CONFIG: Record<ReadingKind, CatalogFilterConfig> = {
  manga: titleConfig('Тип'),
  // У Renovels «тип» — происхождение: Корея, Китай, Япония, авторское.
  ranobe: titleConfig('Происхождение'),
  books: {
    tri: [
      {
        key: 'genres',
        title: 'Жанры',
        param: READING_PARAM.genres,
        paramExclude: READING_PARAM.genresExclude,
        layout: 'list',
        names: true,
        searchable: true,
      },
      {
        // Откроется ли без Флибусты (24.10.2026, миграция 0067): своя копия
        // на сервере или находка в запасной библиотеке.
        key: 'availability',
        title: 'Наличие',
        param: READING_PARAM.availability,
        paramExclude: READING_PARAM.availabilityExclude,
        layout: 'checkboxes',
        options: [
          { value: 'local', label: 'Сохранены у нас' },
          { value: 'coollib', label: 'Есть в КулЛибе' },
        ],
      },
    ],
    ranges: [YEAR_RANGE],
    sorts: BOOK_SORTS,
    defaultSort: READING_DEFAULT_SORT,
  },
  audiobooks: {
    tri: [
      {
        key: 'genres',
        title: 'Жанры',
        param: READING_PARAM.genres,
        paramExclude: READING_PARAM.genresExclude,
        layout: 'list',
        names: true,
        searchable: true,
      },
    ],
    ranges: [
      {
        key: 'hours',
        title: 'Длительность, часов',
        fromField: 'hoursFrom',
        toField: 'hoursTo',
        fromParam: READING_PARAM.hoursFrom,
        toParam: READING_PARAM.hoursTo,
        min: 0,
        max: 500,
        fromPlaceholder: 'от',
        toPlaceholder: 'до',
      },
    ],
    sorts: AUDIOBOOK_SORTS,
    defaultSort: READING_DEFAULT_SORT,
  },
};

export function parseReadingSort(kind: ReadingKind, value: string | null | undefined): ReadingSort {
  return READING_FILTER_CONFIG[kind].sorts.some((s) => s.value === value)
    ? (value as ReadingSort)
    : READING_DEFAULT_SORT;
}

export const READING_CATALOG_META: Record<ReadingKind, { title: string; path: string; section: string }> = {
  manga: { title: 'Каталог манги', path: '/manga/catalog', section: '/manga' },
  ranobe: { title: 'Каталог ранобэ', path: '/ranobe/catalog', section: '/ranobe' },
  books: { title: 'Каталог книг', path: '/books/catalog', section: '/books' },
  audiobooks: { title: 'Каталог аудиокниг', path: '/audiobooks/catalog', section: '/audiobooks' },
};

/**
 * Каталог раздела чтения для пути (шапка, нижняя панель): из манги —
 * каталог манги, а не аниме. null — путь не из раздела чтения.
 */
export function readingCatalogHref(pathname: string): string | null {
  for (const meta of Object.values(READING_CATALOG_META)) {
    if (pathname === meta.section || pathname.startsWith(`${meta.section}/`)) return meta.path;
  }
  return null;
}

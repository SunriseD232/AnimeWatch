/**
 * Фоновые джобы, которые можно запустить руками со страницы состояния.
 *
 * Список общий для клиента (кнопки) и сервера (проверка присланного имени),
 * поэтому лежит отдельно от обоих и не тянет ни `next/headers`, ни
 * сервисный клиент Supabase.
 */

export interface JobStateRef {
  table:
    | 'anime_index_state'
    | 'cinema_index_state'
    | 'podcast_index_state'
    | 'book_index_state'
    | 'ranobe_index_state'
    | 'manga_index_state'
    | 'source_link_state'
    | 'book_storage_state';
  startedColumn: string;
  finishedColumn: string;
  /** Колонка-ключ строки состояния. По умолчанию `id`. */
  keyColumn?: string;
  /** Значение ключа. По умолчанию `true`. */
  keyValue?: string | boolean;
}

export interface JobDef {
  /** Подпись на кнопке — по разделу страницы, а не по имени роута. */
  label: string;
  /** Чего ждать: показывается рядом с кнопкой, чтобы «висит?» не пугало. */
  duration: string;
  /** Где смотреть, идёт ли прогон прямо сейчас. null — такой записи нет. */
  state: JobStateRef | null;
  /** Разумный потолок; дольше — считаем прогон брошенным, см. route.ts. */
  maxRunMs: number;
}

export const JOBS = {
  'reindex-anime': {
    label: 'Перестроить индекс аниме',
    duration: '~13 минут',
    state: {
      table: 'anime_index_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
    },
    maxRunMs: 60 * 60 * 1000,
  },
  'reindex-cinema': {
    label: 'Перестроить индекс кино',
    duration: '~7 минут',
    state: {
      table: 'cinema_index_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
    },
    maxRunMs: 60 * 60 * 1000,
  },
  'refresh-cinema-ratings': {
    label: 'Обновить рейтинги TMDB',
    duration: 'до 100 минут',
    state: {
      table: 'cinema_index_state',
      startedColumn: 'ratings_run_started_at',
      finishedColumn: 'ratings_run_finished_at',
    },
    maxRunMs: 3 * 60 * 60 * 1000,
  },
  'refresh-cinema-genres': {
    label: 'Обновить жанры IMDb',
    duration: 'меньше минуты',
    state: {
      table: 'cinema_index_state',
      startedColumn: 'genres_run_started_at',
      finishedColumn: 'genres_run_finished_at',
    },
    maxRunMs: 30 * 60 * 1000,
  },
  'reindex-podcasts': {
    label: 'Перестроить каталог подкастов',
    duration: '~10-20 минут',
    state: {
      table: 'podcast_index_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
    },
    // Потолок с запасом: iTunes лимитит ~20 запросов в минуту на IP, а
    // регионов 19 × слов 4 — это около 76 запросов с паузой 3.5 сек.
    maxRunMs: 90 * 60 * 1000,
  },
  'reindex-books': {
    label: 'Перестроить каталог книг',
    duration: '~2-3 минуты',
    state: {
      table: 'book_index_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
    },
    // ~120 запросов к Флибусте с паузой 0,7 сек. Потолок с большим запасом:
    // если зеркало начнёт отвечать медленно, прогон растянется, но не
    // оборвётся на середине.
    maxRunMs: 60 * 60 * 1000,
  },
  'reindex-ranobe': {
    label: 'Перестроить каталог ранобэ',
    duration: '~3-5 минут',
    state: {
      table: 'ranobe_index_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
    },
    // ~37 запросов к Renovels с паузой 250 мс. Потолок с запасом: если
    // источник начнёт отвечать медленно, прогон растянется, но не оборвётся.
    maxRunMs: 60 * 60 * 1000,
  },
  'reindex-manga': {
    label: 'Перестроить каталог манги',
    duration: '~3-5 минут',
    state: {
      table: 'manga_index_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
    },
    // ~56 запросов к Remanga с паузой 250 мс (каталог отдаёт максимум 30
    // записей). Потолок с запасом: если источник начнёт отвечать медленно,
    // прогон растянется, но не оборвётся.
    maxRunMs: 60 * 60 * 1000,
  },
  'link-manga-sources': {
    label: 'Сопоставить мангу с источниками',
    // Джоба chunked: один запуск — один батч. Повторять, пока не done.
    duration: 'один батч (~20 тайтлов)',
    state: {
      table: 'source_link_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
      keyColumn: 'job',
      keyValue: 'manga',
    },
    maxRunMs: 15 * 60 * 1000,
  },
  'link-ranobe-flibusta': {
    label: 'Сопоставить ранобэ с Флибустой',
    duration: 'один батч (~10 тайтлов)',
    state: {
      table: 'source_link_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
      keyColumn: 'job',
      keyValue: 'ranobe',
    },
    maxRunMs: 15 * 60 * 1000,
  },
  'cleanup-saved-books': {
    label: 'Убрать просроченные книги с сервера',
    duration: 'секунды',
    state: {
      table: 'book_storage_state',
      startedColumn: 'last_run_started_at',
      finishedColumn: 'last_run_finished_at',
    },
    // Долго только при перекачке пропавших файлов с Флибусты.
    maxRunMs: 15 * 60 * 1000,
  },
  'cache-posters': {
    label: 'Докачать обложки',
    duration: 'секунды, если индекс свежий',
    // Своей записи о прогоне у обложек нет, а заводить таблицу ради одной
    // кнопки — лишнее: прогон короткий, и повторный запуск просто найдёт,
    // что качать нечего.
    state: null,
    maxRunMs: 90 * 60 * 1000,
  },
  'check-episodes': {
    label: 'Проверить новые серии',
    duration: 'меньше минуты',
    state: null,
    maxRunMs: 30 * 60 * 1000,
  },
} as const satisfies Record<string, JobDef>;

export type JobName = keyof typeof JOBS;

export function isJobName(value: string): value is JobName {
  return Object.prototype.hasOwnProperty.call(JOBS, value);
}

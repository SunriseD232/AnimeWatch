/**
 * Фоновые джобы, которые можно запустить руками со страницы состояния.
 *
 * Список общий для клиента (кнопки) и сервера (проверка присланного имени),
 * поэтому лежит отдельно от обоих и не тянет ни `next/headers`, ни
 * сервисный клиент Supabase.
 */

export interface JobStateRef {
  table: 'anime_index_state' | 'cinema_index_state';
  startedColumn: string;
  finishedColumn: string;
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

/**
 * Тип контента. 'anime' — каталог Shikimori + поиск Kodik по shikimori_id.
 * 'cinema' — фильмы/сериалы из каталога Kodik + поиск по kinopoisk_id.
 */
export type ContentType = 'anime' | 'cinema';

/** Строка прогресса просмотра (таблица watch_progress). */
export interface WatchProgress {
  id: string;
  user_id: string;
  content_type: ContentType;
  // Для 'anime' — shikimori_id, для 'cinema' — kinopoisk_id (колонка общая).
  shikimori_id: number;
  anime_title: string;
  poster_url: string | null;
  episode: number;
  position_seconds: number;
  duration_seconds: number | null;
  translation_id: number | null;
  updated_at: string;
}

/** Данные для upsert прогресса (без серверных полей). */
export interface WatchProgressInput {
  content_type: ContentType;
  shikimori_id: number;
  anime_title: string;
  poster_url: string | null;
  episode: number;
  position_seconds: number;
  duration_seconds: number | null;
  translation_id: number | null;
}

export type UserListStatus =
  | 'watching'
  | 'planned'
  | 'completed'
  | 'dropped';

/** Строка пользовательского списка (таблица user_list). */
export interface UserListItem {
  id: string;
  user_id: string;
  content_type: ContentType;
  shikimori_id: number;
  anime_title: string;
  poster_url: string | null;
  status: UserListStatus;
  created_at: string;
}

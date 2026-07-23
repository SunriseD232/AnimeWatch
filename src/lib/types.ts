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
  /** Сезон (для сериалов кино). Аниме/фильмы — всегда 1. */
  season: number;
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
  season: number;
  episode: number;
  position_seconds: number;
  duration_seconds: number | null;
  translation_id: number | null;
  /** Режим «отметить открытую серию» без позиции (Videoseed). */
  mark?: boolean;
  /** Пометить серию season/episode полностью просмотренной. */
  watched_episode?: boolean;
  /** Перевести тайтл в user_list со статусом completed. */
  completed?: boolean;
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

/** Уведомление о новых сериях (таблица episode_notifications). */
export interface EpisodeNotification {
  kind: 'episode';
  id: string;
  user_id: string;
  content_type: ContentType;
  shikimori_id: number;
  title: string;
  poster_url: string | null;
  /** Новое общее число серий на момент уведомления. */
  episode: number;
  created_at: string;
  read_at: string | null;
}

/** Системное уведомление (таблица system_notifications) — только админам. */
export interface SystemNotification {
  kind: 'system';
  id: string;
  user_id: string;
  key: string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

export type AppNotification = EpisodeNotification | SystemNotification;

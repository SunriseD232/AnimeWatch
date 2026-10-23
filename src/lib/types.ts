/**
 * Тип контента. 'anime' — каталог Shikimori + поиск Kodik по shikimori_id.
 * 'cinema' — фильмы/сериалы из каталога Kodik + поиск по kinopoisk_id.
 * 'podcast' — аудиоподкасты из iTunes/RSS; shikimori_id хранит Apple
 * collectionId (см. миграцию 0051 — колонка стала bigint, Apple id бывает
 * больше int32).
 * 'book' | 'manga' | 'ranobe' — чтение (миграция 0053). shikimori_id несёт
 * внешний id источника, а сам источник — в отдельной колонке `source`
 * (у ReManga и Renovels свои числовые id, без неё они бы столкнулись).
 */
export type ContentType = 'anime' | 'cinema' | 'podcast' | 'book' | 'manga' | 'ranobe';

/**
 * Типы контента, у которых есть каталог с постерами и подборками (аниме,
 * кино). Подкасты сюда не входят: у них нет «похожего», рейтингов и
 * backdrop-баннеров — эти механизмы завязаны на постере 2:3 и Shikimori/
 * Kinopoisk-каталоги (см. recommendations.ts, lib/social/server.ts).
 *
 * Отдельный тип, а не просто 'anime' | 'cinema' на месте: раньше ContentType
 * был ровно этими двумя, и после добавления подкастов компилятор сам показал
 * все места, где подразумевался каталог, а не любой контент.
 */
export type CatalogType = Exclude<ContentType, 'podcast' | 'book' | 'manga' | 'ranobe'>;

/**
 * Единица позиции внутри юнита (watch_progress.unit, миграция 0053).
 * Секунда годится только для видео и звука; книга — это проценты (точной
 * доли в числителе нет, она в locator), манга — страница.
 */
export type ProgressUnit = 'seconds' | 'page' | 'chapter' | 'percent';

/** Источник тайтла для типов, где он неоднозначен (книги/манга/ранобэ). */
export type ContentSource =
  | 'flibusta'
  | 'remanga'
  | 'renovels'
  | 'mangadex'
  | 'mangalib'
  | 'selfmanga'
  | 'mintmanga'
  | 'yai'
  | 'shikimori'
  | 'itunes';

/** Строка прогресса просмотра (таблица watch_progress). */
export interface WatchProgress {
  id: string;
  user_id: string;
  content_type: ContentType;
  // Для 'anime' — shikimori_id, для 'cinema' — kinopoisk_id, для 'podcast' —
  // Apple collectionId (колонка общая, см. миграцию 0051).
  shikimori_id: number;
  anime_title: string;
  poster_url: string | null;
  /** Сезон (для сериалов кино). Аниме/фильмы — всегда 1. */
  season: number;
  episode: number;
  position_seconds: number;
  duration_seconds: number | null;
  translation_id: number | null;
  /** Текстовая метка озвучки — см. миграцию 0008 (translation_id Yummy не
   *  стабилен между сериями, поэтому для восстановления используем строку). */
  translation_title: string | null;
  /** Источник тайтла для книг/манги/ранобэ (миграция 0053). У аниме/кино/
   *  подкастов null: там источник однозначен по content_type. */
  source?: ContentSource | null;
  /** Единица позиции (миграция 0053). Старые строки — 'seconds'. */
  unit?: ProgressUnit;
  /** Доля прочитанного 0..1 (книги/ранобэ/манга). Точное место — в locator. */
  progress_percent?: number | null;
  /** Место, которое не влезает в число: cfi epub.js, chapterId, chapterLabel
   *  («Том 3, глава 5»), scrollY. См. миграцию 0053. */
  locator?: Record<string, unknown> | null;
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
  translation_title: string | null;
  /** Источник тайтла для книг/манги/ранобэ (миграция 0053). */
  source?: ContentSource | null;
  /** Единица позиции (миграция 0053). Не задана — сервер считает 'seconds'. */
  unit?: ProgressUnit;
  /** Доля прочитанного 0..1 (книги/ранобэ). */
  progress_percent?: number | null;
  /** Место, которое не влезает в число (cfi, chapterId, chapterLabel). */
  locator?: Record<string, unknown> | null;
  /** Режим «отметить открытую серию» без позиции (Videoseed). */
  mark?: boolean;
  /** Пометить серию season/episode полностью просмотренной. */
  watched_episode?: boolean;
  /** Перевести тайтл в user_list со статусом completed. */
  completed?: boolean;
}

export type UserListStatus =
  | 'watching'
  | 'rewatching'
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
  /** Не присылать уведомления о новых сериях по этому тайтлу (см. миграцию
   *  0016 и api/cron/check-episodes) — не убирая тайтл из списка целиком. */
  muted: boolean;
  created_at: string;
}

/** Одна досмотренная серия (таблица watched_episodes) — используется историей
 *  просмотра в профиле. */
export interface WatchedEpisode {
  id: string;
  content_type: ContentType;
  shikimori_id: number;
  season: number;
  episode: number;
  anime_title: string | null;
  poster_url: string | null;
  watched_at: string;
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

/** Социальное уведомление (таблица social_notifications, миграция 0037). */
export interface SocialNotification {
  kind: 'social';
  id: string;
  user_id: string;
  type: 'friend_request' | 'friend_accepted' | 'comment_reply';
  actor: { id: string; name: string; avatarUrl: string | null } | null;
  comment_id: string | null;
  content_type: ContentType | null;
  shikimori_id: number | null;
  season: number | null;
  episode: number | null;
  title: string | null;
  snippet: string | null;
  created_at: string;
  read_at: string | null;
}

export type AppNotification = EpisodeNotification | SystemNotification | SocialNotification;

import type { ContentType } from '@/lib/types';

/** То, что о человеке видят другие: имя и аватар. Почты здесь нет намеренно. */
export interface PublicUser {
  id: string;
  /** Уже с запасной подписью (см. nameOf) — пустым не бывает. */
  name: string;
  /** Задал ли человек имя сам — форма профиля показывает поле пустым, если нет. */
  hasCustomName: boolean;
  avatarUrl: string | null;
}

/**
 * Отношение текущего пользователя к другому:
 * self — это он сам; none — никак; outgoing — он отправил заявку;
 * incoming — заявку отправили ему; friends — дружат.
 */
export type FriendshipState = 'self' | 'none' | 'outgoing' | 'incoming' | 'friends';

export interface FriendEntry {
  user: PublicUser;
  state: Exclude<FriendshipState, 'self' | 'none'>;
}

/** Средняя оценка пользователей сайта. */
export interface SiteRating {
  average: number;
  votes: number;
}

export interface TitleRating {
  contentType: ContentType;
  shikimoriId: number;
  score: number;
  title: string | null;
  posterUrl: string | null;
  updatedAt: string;
}

export interface EpisodeComment {
  id: string;
  /** Пустая строка у удалённого: текст наружу не отдаётся. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Удалён, но оставлен заглушкой ради ответов под ним. */
  deleted: boolean;
  /** На что отвечают; null у верхнего комментария ветки. */
  parentId: string | null;
  /** Верхний комментарий ветки; null у него самого. */
  rootId: string | null;
  author: PublicUser;
  /** Свой — можно править и удалять. */
  mine: boolean;
  /** Удалить можно своё, а админу — любое. */
  canDelete: boolean;
}

/** Верхний комментарий с числом ответов и, для коротких веток, самими ответами. */
export interface CommentThread {
  comment: EpisodeComment;
  replyCount: number;
  /** Загруженные ответы, по времени. Для длинных веток пусто до раскрытия. */
  replies: EpisodeComment[];
}

/** Свой комментарий в разделе «Мои комментарии» — вне страницы серии. */
export interface MyComment {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  isReply: boolean;
  replyCount: number;
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
  title: string | null;
  posterUrl: string | null;
}

export type Visibility = 'everyone' | 'friends' | 'nobody';

export interface PrivacySettings {
  lists: Visibility;
  ratings: Visibility;
}

export const DEFAULT_PRIVACY: PrivacySettings = { lists: 'friends', ratings: 'friends' };

export function normalizeVisibility(value: unknown, fallback: Visibility = 'friends'): Visibility {
  return value === 'everyone' || value === 'friends' || value === 'nobody' ? value : fallback;
}

/** Ссылка на серию, где живёт комментарий, с якорем на него самого. */
export function commentHref(c: {
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
  id: string;
}): string {
  const base =
    c.contentType === 'cinema'
      ? `/cinema/watch/${c.shikimoriId}/${c.season}/${c.episode}`
      : `/watch/${c.shikimoriId}/${c.episode}`;
  return `${base}?comment=${c.id}`;
}

export const COMMENT_MAX_LENGTH = 2000;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

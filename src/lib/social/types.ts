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
  body: string;
  createdAt: string;
  editedAt: string | null;
  author: PublicUser;
  /** Свой — можно править и удалять. */
  mine: boolean;
  /** Удалить можно своё, а админу — любое. */
  canDelete: boolean;
}

export const COMMENT_MAX_LENGTH = 2000;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

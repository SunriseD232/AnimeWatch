import type { EpisodeComment, PublicUser } from './types';

/** Строка episode_comments в том виде, в каком её выбирают API-маршруты. */
export interface CommentRow {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export const COMMENT_COLUMNS = 'id, user_id, body, created_at, edited_at';

export function toComment(
  row: CommentRow,
  author: PublicUser,
  me: string,
  isAdmin: boolean,
): EpisodeComment {
  const mine = row.user_id === me;
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    author,
    mine,
    canDelete: mine || isAdmin,
  };
}

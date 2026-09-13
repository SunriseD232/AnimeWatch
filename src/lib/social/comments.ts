import type { createClient } from '@/lib/supabase/server';
import type { ContentType } from '@/lib/types';
import type { CommentThread, EpisodeComment, PublicUser } from './types';

type Supabase = ReturnType<typeof createClient>;

/** Строка episode_comments в том виде, в каком её выбирают API-маршруты. */
export interface CommentRow {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  parent_id: string | null;
  root_id: string | null;
}

export const COMMENT_COLUMNS = 'id, user_id, body, created_at, edited_at, deleted_at, parent_id, root_id';

/** Ветки, где ответов не больше этого, приходят сразу раскрытыми. Длиннее —
 *  свёрнуты до клика «Показать N ответов»: страница серии не должна тянуть
 *  сотню ответов на каждый из тридцати верхних комментариев. */
export const INLINE_REPLIES = 3;

export function toComment(
  row: CommentRow,
  author: PublicUser,
  me: string,
  isAdmin: boolean,
): EpisodeComment {
  const mine = row.user_id === me;
  const deleted = row.deleted_at != null;
  return {
    id: row.id,
    // Текст удалённого не уходит в браузер вовсе, а не прячется вёрсткой.
    body: deleted ? '' : row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted,
    parentId: row.parent_id,
    rootId: row.root_id,
    author,
    mine: mine && !deleted,
    canDelete: !deleted && (mine || isAdmin),
  };
}

export interface ThreadLocator {
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
}

/** Число живых ответов по веткам — одним вызовом (RPC comment_reply_counts). */
export async function getReplyCounts(supabase: Supabase, roots: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (roots.length === 0) return result;
  const { data } = await supabase.rpc('comment_reply_counts', { p_roots: roots });
  for (const row of (data ?? []) as { root_id: string; replies: number }[]) {
    result.set(row.root_id, row.replies);
  }
  return result;
}

/**
 * Данные для веток верхних комментариев: число ответов у каждой и сами ответы
 * для коротких (не длиннее INLINE_REPLIES) и для явно раскрываемой ветки —
 * одним запросом на всю страницу. Авторов маршрут дорешивает сам, пачкой.
 */
export async function loadThreadRows(
  supabase: Supabase,
  roots: CommentRow[],
  expandRoot?: string,
): Promise<{ counts: Map<string, number>; replyRows: CommentRow[] }> {
  const counts = await getReplyCounts(
    supabase,
    roots.map((r) => r.id),
  );
  const inline = roots
    .filter((r) => r.id === expandRoot || (counts.get(r.id) ?? 0) <= INLINE_REPLIES)
    .map((r) => r.id);

  let replyRows: CommentRow[] = [];
  if (inline.length > 0) {
    const { data } = await supabase
      .from('episode_comments')
      .select(COMMENT_COLUMNS)
      .in('root_id', inline)
      .order('created_at', { ascending: true })
      .limit(500);
    replyRows = (data ?? []) as CommentRow[];
  }
  return { counts, replyRows };
}

export function assembleThreads(
  roots: CommentRow[],
  counts: Map<string, number>,
  replyRows: CommentRow[],
  toPublic: (row: CommentRow) => EpisodeComment,
): CommentThread[] {
  const byRoot = new Map<string, EpisodeComment[]>();
  for (const row of replyRows) {
    const key = row.root_id as string;
    const list = byRoot.get(key) ?? [];
    list.push(toPublic(row));
    byRoot.set(key, list);
  }
  return roots.map((root) => ({
    comment: toPublic(root),
    replyCount: counts.get(root.id) ?? 0,
    replies: byRoot.get(root.id) ?? [],
  }));
}

import { createClient } from '@/lib/supabase/server';
import type { ContentType } from '@/lib/types';
import { nameOf } from './names';
import type { FriendEntry, FriendshipState, PublicUser, SiteRating, TitleRating } from './types';

/**
 * Серверные чтения социальной части (миграция 0036).
 *
 * Всё идёт клиентом С СЕССИЕЙ пользователя, не service_role: кто что видит,
 * решает RLS — оценки только друзей, дружба только своя. Код здесь не
 * фильтрует чужое сам, и ошибиться в фильтре, показав лишнее, негде.
 */

type Supabase = ReturnType<typeof createClient>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  avatar_path: string | null;
}

export function toPublicUser(id: string, row: ProfileRow | null | undefined): PublicUser {
  return {
    id,
    name: nameOf(row?.display_name, id),
    hasCustomName: !!row?.display_name,
    avatarUrl: row?.avatar_path ?? null,
  };
}

/** Имена и аватары пачкой — один запрос на страницу, а не на человека. */
export async function getPublicUsers(
  supabase: Supabase,
  ids: string[],
): Promise<Map<string, PublicUser>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, PublicUser>();
  if (unique.length === 0) return result;
  const { data } = await supabase
    .from('profiles')
    .select('user_id, display_name, avatar_path')
    .in('user_id', unique);
  const rows = new Map((data ?? []).map((r) => [r.user_id as string, r as ProfileRow]));
  for (const id of unique) result.set(id, toPublicUser(id, rows.get(id)));
  return result;
}

interface FriendshipRow {
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
}

function stateFor(me: string, row: FriendshipRow): Exclude<FriendshipState, 'self' | 'none'> {
  if (row.status === 'accepted') return 'friends';
  return row.requester_id === me ? 'outgoing' : 'incoming';
}

export async function getFriendshipState(
  supabase: Supabase,
  me: string,
  other: string,
): Promise<FriendshipState> {
  if (me === other) return 'self';
  // RLS и так отдаёт только строки, где участвует me, — достаточно найти
  // ту, где участвует второй.
  const { data } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id, status')
    .or(`requester_id.eq.${other},addressee_id.eq.${other}`)
    .maybeSingle();
  return data ? stateFor(me, data as FriendshipRow) : 'none';
}

/** Все связи пользователя: друзья, входящие и исходящие заявки. */
export async function listFriendships(supabase: Supabase, me: string): Promise<FriendEntry[]> {
  const { data } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id, status, created_at')
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as (FriendshipRow & { created_at: string })[];
  const others = rows.map((r) => (r.requester_id === me ? r.addressee_id : r.requester_id));
  const users = await getPublicUsers(supabase, others);
  return rows.map((row, i) => ({
    user: users.get(others[i]) as PublicUser,
    state: stateFor(me, row),
  }));
}

/** Сколько заявок ждут ответа — для точки на иконке профиля. */
export async function countIncomingRequests(supabase: Supabase, me: string): Promise<number> {
  const { count } = await supabase
    .from('friendships')
    .select('requester_id', { count: 'exact', head: true })
    .eq('addressee_id', me)
    .eq('status', 'pending');
  return count ?? 0;
}

/**
 * Средняя оценка сайта по пачке тайтлов. Сбой — пустая карта: рейтинг на
 * карточке необязателен, и ронять из-за него каталог нельзя.
 */
export async function getSiteRatings(
  contentType: ContentType,
  ids: number[],
): Promise<Map<number, SiteRating>> {
  const result = new Map<number, SiteRating>();
  if (ids.length === 0) return result;
  try {
    const { data, error } = await createClient().rpc('title_rating_summary', {
      p_content_type: contentType,
      p_ids: ids,
    });
    if (error || !data) return result;
    for (const row of data as { shikimori_id: number; average: number | string; votes: number }[]) {
      result.set(row.shikimori_id, { average: Number(row.average), votes: row.votes });
    }
  } catch {
    // см. комментарий к функции
  }
  return result;
}

interface RatingRow {
  user_id: string;
  content_type: ContentType;
  shikimori_id: number;
  score: number;
  anime_title: string | null;
  poster_url: string | null;
  updated_at: string;
}

function toTitleRating(row: RatingRow): TitleRating {
  return {
    contentType: row.content_type,
    shikimoriId: row.shikimori_id,
    score: row.score,
    title: row.anime_title,
    posterUrl: row.poster_url,
    updatedAt: row.updated_at,
  };
}

/** Оценки конкретного человека. Чужие вернутся, только если вы друзья (RLS). */
export async function getUserRatings(supabase: Supabase, userId: string): Promise<TitleRating[]> {
  const { data } = await supabase
    .from('title_ratings')
    .select('user_id, content_type, shikimori_id, score, anime_title, poster_url, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(500);
  return ((data ?? []) as RatingRow[]).map(toTitleRating);
}

export interface TitleRatingContext {
  /** Своя оценка, null — не ставил. */
  myScore: number | null;
  site: SiteRating | null;
  /** Оценки друзей этого тайтла, свежие сверху. */
  friends: { user: PublicUser; score: number }[];
}

/** Всё про оценки для страницы тайтла — три запроса параллельно. */
export async function getTitleRatingContext(
  supabase: Supabase,
  me: string,
  contentType: ContentType,
  shikimoriId: number,
): Promise<TitleRatingContext> {
  const [{ data }, site] = await Promise.all([
    supabase
      .from('title_ratings')
      .select('user_id, score, updated_at')
      .eq('content_type', contentType)
      .eq('shikimori_id', shikimoriId)
      .order('updated_at', { ascending: false }),
    getSiteRatings(contentType, [shikimoriId]),
  ]);
  const rows = (data ?? []) as { user_id: string; score: number }[];
  const mine = rows.find((r) => r.user_id === me);
  const friendRows = rows.filter((r) => r.user_id !== me);
  const users = await getPublicUsers(
    supabase,
    friendRows.map((r) => r.user_id),
  );
  return {
    myScore: mine?.score ?? null,
    site: site.get(shikimoriId) ?? null,
    friends: friendRows.map((r) => ({ user: users.get(r.user_id) as PublicUser, score: r.score })),
  };
}

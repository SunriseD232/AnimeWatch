import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { getReplyCounts } from '@/lib/social/comments';
import type { MyComment } from '@/lib/social/types';
import type { ContentType } from '@/lib/types';

/**
 * GET /api/comments/mine[?before=ISO] — свои комментарии по всему сайту, от
 * новых к старым, для раздела «Комментарии» в профиле. Удалённые (мягко,
 * заглушкой) сюда не попадают: править и удалять в них уже нечего.
 */

const PAGE_SIZE = 30;

interface Row {
  id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  parent_id: string | null;
  content_type: ContentType;
  shikimori_id: number;
  season: number;
  episode: number;
  anime_title: string | null;
  poster_url: string | null;
}

export async function GET(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы увидеть свои комментарии.' }, { status: 401 });

  const supabase = createClient();
  let query = supabase
    .from('episode_comments')
    .select(
      'id, body, created_at, edited_at, parent_id, content_type, shikimori_id, season, episode, anime_title, poster_url',
    )
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1);
  const before = request.nextUrl.searchParams.get('before');
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) {
    console.error(`[comments] mine user=${user.id} failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось загрузить комментарии.' }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, PAGE_SIZE);
  // Ответы считаем только у верхних комментариев: у ответа своей ветки нет.
  const counts = await getReplyCounts(
    supabase,
    page.filter((r) => r.parent_id == null).map((r) => r.id),
  );

  const comments: MyComment[] = page.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    isReply: r.parent_id != null,
    replyCount: counts.get(r.id) ?? 0,
    contentType: r.content_type,
    shikimoriId: r.shikimori_id,
    season: r.season,
    episode: r.episode,
    title: r.anime_title,
    posterUrl: r.poster_url,
  }));

  return NextResponse.json({ comments, hasMore: rows.length > PAGE_SIZE });
}

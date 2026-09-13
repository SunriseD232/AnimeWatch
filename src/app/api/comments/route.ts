import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { COMMENT_COLUMNS, toComment, type CommentRow } from '@/lib/social/comments';
import { getPublicUsers } from '@/lib/social/server';
import { COMMENT_MAX_LENGTH, type PublicUser } from '@/lib/social/types';
import type { ContentType } from '@/lib/types';

/**
 * GET  /api/comments?type=anime&id=123&season=1&episode=4[&before=ISO]
 *      — лента серии, от новых к старым, страницами по PAGE_SIZE.
 * POST /api/comments { type, id, season, episode, body } — написать.
 *
 * Серия приходит параметрами, а не берётся из адреса страницы: плеер
 * переключает серии без навигации (history.pushState в WatchPlayer/Player),
 * и блок комментариев следует за активной серией плеера, а не за URL.
 */

const PAGE_SIZE = 30;

interface Thread {
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
}

function readThread(source: { get(name: string): string | null }): Thread | null {
  const type = source.get('type');
  const id = Number(source.get('id'));
  const season = Number(source.get('season') ?? '1');
  const episode = Number(source.get('episode'));
  if (type !== 'anime' && type !== 'cinema') return null;
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!Number.isInteger(season) || season < 1) return null;
  if (!Number.isInteger(episode) || episode < 1) return null;
  return { contentType: type, shikimoriId: id, season, episode };
}

export async function GET(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы читать обсуждение.' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const thread = readThread(params);
  if (!thread) return NextResponse.json({ error: 'Не понял, какая серия.' }, { status: 400 });

  const supabase = createClient();
  let query = supabase
    .from('episode_comments')
    .select(COMMENT_COLUMNS)
    .eq('content_type', thread.contentType)
    .eq('shikimori_id', thread.shikimoriId)
    .eq('season', thread.season)
    .eq('episode', thread.episode)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1);

  const before = params.get('before');
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt('created_at', before);

  // Общее число — только для первой страницы: заголовок «Обсуждение · 12».
  const countPromise = before
    ? Promise.resolve(null)
    : supabase
        .from('episode_comments')
        .select('id', { count: 'exact', head: true })
        .eq('content_type', thread.contentType)
        .eq('shikimori_id', thread.shikimoriId)
        .eq('season', thread.season)
        .eq('episode', thread.episode)
        .then(({ count }) => count ?? 0);

  const [{ data, error }, total] = await Promise.all([query, countPromise]);
  if (error) {
    console.error(`[comments] list failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось загрузить обсуждение.' }, { status: 500 });
  }

  const rows = (data ?? []) as CommentRow[];
  const page = rows.slice(0, PAGE_SIZE);
  const authors = await getPublicUsers(
    supabase,
    page.map((r) => r.user_id),
  );
  const isAdmin = isAdminEmail(user.email);

  return NextResponse.json({
    comments: page.map((r) => toComment(r, authors.get(r.user_id) as PublicUser, user.id, isAdmin)),
    hasMore: rows.length > PAGE_SIZE,
    total,
  });
}

export async function POST(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы писать комментарии.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const thread = readThread({
    get: (name) => (body?.[name] == null ? null : String(body[name])),
  });
  if (!thread) return NextResponse.json({ error: 'Не понял, к какой серии комментарий.' }, { status: 400 });

  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (text.length === 0) {
    return NextResponse.json({ error: 'Комментарий пустой. Напишите хоть пару слов.' }, { status: 400 });
  }
  if (text.length > COMMENT_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Комментарий длиннее ${COMMENT_MAX_LENGTH} символов. Сократите его.` },
      { status: 400 },
    );
  }

  // Две корзины: частая ловит залп, редкая — длинную рассылку.
  const burst = checkRateLimit(`comments:burst:${user.id}`, 5, 60_000);
  const hourly = burst.allowed ? checkRateLimit(`comments:hour:${user.id}`, 60, 60 * 60_000) : burst;
  if (!burst.allowed || !hourly.allowed) {
    const seconds = Math.ceil(Math.max(burst.retryAfterMs, hourly.retryAfterMs) / 1000);
    return NextResponse.json(
      { error: `Слишком часто. Следующий комментарий можно через ${seconds} с.` },
      { status: 429 },
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('episode_comments')
    .insert({
      user_id: user.id,
      content_type: thread.contentType,
      shikimori_id: thread.shikimoriId,
      season: thread.season,
      episode: thread.episode,
      body: text,
    })
    .select(COMMENT_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`[comments] user=${user.id} insert failed: ${error?.message}`);
    return NextResponse.json({ error: 'Не удалось отправить. Попробуйте ещё раз.' }, { status: 500 });
  }

  const authors = await getPublicUsers(supabase, [user.id]);
  return NextResponse.json({
    comment: toComment(data as CommentRow, authors.get(user.id) as PublicUser, user.id, isAdminEmail(user.email)),
  });
}

import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { COMMENT_COLUMNS, toComment, type CommentRow } from '@/lib/social/comments';
import { UUID_RE, getPublicUsers } from '@/lib/social/server';
import type { PublicUser } from '@/lib/social/types';

/**
 * GET /api/comments/replies?root=<id>[&after=ISO] — ответы одной ветки, по
 * времени, страницами по PAGE_SIZE. Зовётся, только когда человек раскрыл
 * длинную ветку: короткие приходят вместе со страницей серии.
 */

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы читать обсуждение.' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const root = params.get('root') ?? '';
  if (!UUID_RE.test(root)) return NextResponse.json({ error: 'Не понял, какая ветка.' }, { status: 400 });

  const supabase = createClient();
  let query = supabase
    .from('episode_comments')
    .select(COMMENT_COLUMNS)
    .eq('root_id', root)
    .order('created_at', { ascending: true })
    .limit(PAGE_SIZE + 1);
  const after = params.get('after');
  if (after && !Number.isNaN(Date.parse(after))) query = query.gt('created_at', after);

  const { data, error } = await query;
  if (error) {
    console.error(`[comments] replies ${root} failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось загрузить ответы.' }, { status: 500 });
  }

  const rows = (data ?? []) as CommentRow[];
  const page = rows.slice(0, PAGE_SIZE);
  const authors = await getPublicUsers(
    supabase,
    page.map((r) => r.user_id),
  );
  const isAdmin = isAdminEmail(user.email);
  return NextResponse.json({
    replies: page.map((r) => toComment(r, authors.get(r.user_id) as PublicUser, user.id, isAdmin)),
    hasMore: rows.length > PAGE_SIZE,
  });
}

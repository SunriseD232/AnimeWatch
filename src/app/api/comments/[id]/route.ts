import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { COMMENT_COLUMNS, toComment, type CommentRow } from '@/lib/social/comments';
import { UUID_RE, getPublicUsers } from '@/lib/social/server';
import { COMMENT_MAX_LENGTH, type PublicUser } from '@/lib/social/types';

/**
 * PATCH  /api/comments/:id { body } — поправить свой комментарий.
 * DELETE /api/comments/:id          — удалить свой; админ — любой.
 */

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы править комментарии.' }, { status: 401 });
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Нет такого комментария.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (text.length === 0) {
    return NextResponse.json({ error: 'Комментарий пустой. Если он не нужен — удалите его.' }, { status: 400 });
  }
  if (text.length > COMMENT_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Комментарий длиннее ${COMMENT_MAX_LENGTH} символов. Сократите его.` },
      { status: 400 },
    );
  }

  // Своё правит клиент с сессией: RLS пропустит только строку автора, а
  // колоночный грант — только текст и отметку о правке.
  const supabase = createClient();
  const { data, error } = await supabase
    .from('episode_comments')
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select(COMMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`[comments] user=${user.id} edit ${params.id} failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось сохранить правку. Попробуйте ещё раз.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Комментарий уже удалён.' }, { status: 404 });

  const authors = await getPublicUsers(supabase, [user.id]);
  return NextResponse.json({
    comment: toComment(data as CommentRow, authors.get(user.id) as PublicUser, user.id, isAdminEmail(user.email)),
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы удалять комментарии.' }, { status: 401 });
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Нет такого комментария.' }, { status: 404 });

  const supabase = createClient();
  const { data: own, error } = await supabase
    .from('episode_comments')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id');
  if (error) {
    console.error(`[comments] user=${user.id} delete ${params.id} failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось удалить. Попробуйте ещё раз.' }, { status: 500 });
  }
  if (own && own.length > 0) return NextResponse.json({ ok: true });

  // Не своё. Удалить может только админ — и тут нужен service_role, поэтому
  // личность перепроверяется сетевым getUser(), а не берётся из куки.
  const {
    data: { user: verified },
  } = await supabase.auth.getUser();
  if (!verified || !isAdminEmail(verified.email)) {
    return NextResponse.json({ error: 'Удалить можно только свой комментарий.' }, { status: 403 });
  }

  const { data: removed, error: adminError } = await createServiceClient()
    .from('episode_comments')
    .delete()
    .eq('id', params.id)
    .select('id, user_id');
  if (adminError) {
    console.error(`[comments] admin=${verified.id} delete ${params.id} failed: ${adminError.message}`);
    return NextResponse.json({ error: 'Не удалось удалить. Попробуйте ещё раз.' }, { status: 500 });
  }
  if (!removed || removed.length === 0) {
    return NextResponse.json({ error: 'Комментарий уже удалён.' }, { status: 404 });
  }
  console.log(`[comments] admin=${verified.id} removed ${params.id} by user=${removed[0].user_id}`);
  return NextResponse.json({ ok: true });
}

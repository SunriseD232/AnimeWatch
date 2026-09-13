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
 *
 * Удаление двух видов. Без ответов — строка удаляется совсем. С ответами —
 * мягко: текст стирается, остаётся заглушка «комментарий удалён», чтобы
 * чужие ответы под ней не потеряли ни себя, ни контекст (каскадное удаление
 * снесло бы их вместе с родителем).
 */

const DELETED_BODY = 'удалён';

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

  // Своё правит клиент с сессией: RLS пропустит только строку автора,
  // колоночный грант — только текст и отметку о правке, триггер — только не
  // удалённый комментарий.
  const supabase = createClient();
  const { data, error } = await supabase
    .from('episode_comments')
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
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
  const { data: target } = await supabase
    .from('episode_comments')
    .select(COMMENT_COLUMNS)
    .eq('id', params.id)
    .maybeSingle();
  const row = target as CommentRow | null;
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Комментарий уже удалён.' }, { status: 404 });

  const own = row.user_id === user.id;
  let writer = supabase;
  if (!own) {
    // Чужое удаляет только админ, и тут нужен service_role — поэтому
    // личность перепроверяется сетевым getUser(), а не берётся из куки.
    const {
      data: { user: verified },
    } = await supabase.auth.getUser();
    if (!verified || !isAdminEmail(verified.email)) {
      return NextResponse.json({ error: 'Удалить можно только свой комментарий.' }, { status: 403 });
    }
    writer = createServiceClient() as unknown as typeof supabase;
  }

  const { data: children } = await supabase
    .from('episode_comments')
    .select('id')
    .eq('parent_id', row.id)
    .limit(1);
  const hasReplies = (children ?? []).length > 0;

  if (hasReplies) {
    const { error } = await writer
      .from('episode_comments')
      .update({ body: DELETED_BODY, deleted_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      console.error(`[comments] user=${user.id} soft delete ${row.id} failed: ${error.message}`);
      return NextResponse.json({ error: 'Не удалось удалить. Попробуйте ещё раз.' }, { status: 500 });
    }
    if (!own) console.log(`[comments] admin=${user.id} soft-removed ${row.id} by user=${row.user_id}`);
    return NextResponse.json({ ok: true, mode: 'soft' });
  }

  const { error } = await writer.from('episode_comments').delete().eq('id', row.id);
  if (error) {
    console.error(`[comments] user=${user.id} delete ${row.id} failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось удалить. Попробуйте ещё раз.' }, { status: 500 });
  }
  if (!own) console.log(`[comments] admin=${user.id} removed ${row.id} by user=${row.user_id}`);

  // Уборка заглушек: если родитель был удалён мягко и это был его последний
  // ответ, заглушка больше ничего не держит. Родитель может быть чужим —
  // это обслуживание без содержимого, поэтому service_role.
  await removeEmptyPlaceholders(row.parent_id);
  return NextResponse.json({ ok: true, mode: 'hard' });
}

async function removeEmptyPlaceholders(parentId: string | null): Promise<void> {
  const service = createServiceClient();
  let current = parentId;
  // Вложенность ограничена здравым смыслом, а не схемой — страхуемся от цикла.
  for (let depth = 0; current && depth < 20; depth++) {
    const { data: parent } = await service
      .from('episode_comments')
      .select('id, parent_id, deleted_at')
      .eq('id', current)
      .maybeSingle();
    if (!parent || !parent.deleted_at) return;
    const { data: rest } = await service.from('episode_comments').select('id').eq('parent_id', parent.id).limit(1);
    if ((rest ?? []).length > 0) return;
    await service.from('episode_comments').delete().eq('id', parent.id);
    current = parent.parent_id as string | null;
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { FEEDBACK_MAX_LENGTH, isFeedbackSection } from '@/lib/feedback';
import { getAdminUserIds, notifyFeedback } from '@/lib/feedbackServer';

export const dynamic = 'force-dynamic';

/** Не больше стольких сообщений в час от одного человека: форма открыта
 *  всем вошедшим, и без потолка ящик админа можно было бы завалить. */
const HOURLY_LIMIT = 20;

/**
 * Обратная связь (миграция 0066).
 *
 *   POST  { section, body }            — новое обращение;
 *   POST  { threadId, body }           — сообщение в обращение: своё или,
 *                                        если пишет админ, ответ;
 *   PATCH { threadId, action }         — read | close | reopen.
 *
 * Личность — через getUser() (сетевой проход к Auth, а не кука): запись
 * идёт service_role в обход RLS и не должна верить непроверенному токену.
 */
async function currentUser() {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  return user;
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы написать нам.' }, { status: 401 });
  const isAdmin = isAdminEmail(user.email);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'Напишите, что случилось.' }, { status: 400 });
  if (text.length > FEEDBACK_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Слишком длинно: не больше ${FEEDBACK_MAX_LENGTH} символов.` },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  if (!isAdmin) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: mine } = await supabase.from('feedback_threads').select('id').eq('user_id', user.id);
    const ids = ((mine ?? []) as { id: string }[]).map((t) => t.id);
    if (ids.length > 0) {
      const { count } = await supabase
        .from('feedback_messages')
        .select('id', { count: 'exact', head: true })
        .in('thread_id', ids)
        .eq('from_admin', false)
        .gte('created_at', since);
      if ((count ?? 0) >= HOURLY_LIMIT) {
        return NextResponse.json(
          { error: 'Слишком много сообщений за час. Попробуйте чуть позже.' },
          { status: 429 },
        );
      }
    }
  }

  let threadId = typeof body?.threadId === 'string' ? body.threadId : null;
  let section: string;
  let ownerId: string;

  if (threadId) {
    const { data: thread } = await supabase
      .from('feedback_threads')
      .select('id, user_id, section')
      .eq('id', threadId)
      .maybeSingle();
    if (!thread || (thread.user_id !== user.id && !isAdmin)) {
      return NextResponse.json({ error: 'Обращение не найдено.' }, { status: 404 });
    }
    section = thread.section;
    ownerId = thread.user_id;
  } else {
    if (!isFeedbackSection(body?.section)) {
      return NextResponse.json({ error: 'Выберите раздел.' }, { status: 400 });
    }
    section = body.section;
    ownerId = user.id;
    const { data: created, error } = await supabase
      .from('feedback_threads')
      .insert({ user_id: user.id, section })
      .select('id')
      .single();
    if (error || !created) {
      console.error(`[feedback] обращение не создалось: ${error?.message}`);
      return NextResponse.json({ error: 'Не удалось отправить. Попробуйте ещё раз.' }, { status: 500 });
    }
    threadId = created.id as string;
  }

  // Ответ админа — только в чужом обращении; в своём админ пишет как все.
  const fromAdmin = isAdmin && ownerId !== user.id;
  const { data: message, error: messageError } = await supabase
    .from('feedback_messages')
    .insert({ thread_id: threadId, author_id: user.id, from_admin: fromAdmin, body: text })
    .select('id, created_at')
    .single();
  if (messageError || !message) {
    console.error(`[feedback] сообщение не записалось: ${messageError?.message}`);
    return NextResponse.json({ error: 'Не удалось отправить. Попробуйте ещё раз.' }, { status: 500 });
  }

  await supabase
    .from('feedback_threads')
    .update({
      last_message_at: message.created_at,
      // Новое сообщение открывает закрытое обращение: человек вернулся с тем же.
      status: 'open',
      ...(fromAdmin ? { user_unread: true, admin_unread: false } : { admin_unread: true, user_unread: false }),
    })
    .eq('id', threadId);

  const recipients = fromAdmin ? [ownerId] : (await getAdminUserIds()).filter((id) => id !== user.id);
  await notifyFeedback({
    recipients,
    messageId: message.id as string,
    threadId,
    section,
    body: text,
    forAdmin: !fromAdmin,
  });

  return NextResponse.json({
    ok: true,
    threadId,
    message: { id: message.id, fromAdmin, body: text, createdAt: message.created_at },
  });
}

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Войдите.' }, { status: 401 });
  const isAdmin = isAdminEmail(user.email);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const threadId = typeof body?.threadId === 'string' ? body.threadId : null;
  const action = body?.action;
  if (!threadId || (action !== 'read' && action !== 'close' && action !== 'reopen')) {
    return NextResponse.json({ error: 'threadId и action: read | close | reopen.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: thread } = await supabase
    .from('feedback_threads')
    .select('id, user_id')
    .eq('id', threadId)
    .maybeSingle();
  const isOwner = thread?.user_id === user.id;
  if (!thread || (!isOwner && !isAdmin)) {
    return NextResponse.json({ error: 'Обращение не найдено.' }, { status: 404 });
  }

  const patch =
    action === 'read'
      ? isOwner
        ? { user_unread: false }
        : { admin_unread: false }
      : { status: action === 'close' ? 'closed' : 'open' };
  const { error } = await supabase.from('feedback_threads').update(patch).eq('id', threadId);
  if (error) return NextResponse.json({ error: 'Не удалось сохранить.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

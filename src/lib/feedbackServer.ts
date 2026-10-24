import { ADMIN_EMAILS } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service';
import { feedbackHref, feedbackSectionLabel, type FeedbackThreadView } from '@/lib/feedback';

/**
 * Обратная связь — серверная часть (миграция 0066): загрузка переписок для
 * профиля и уведомления в колокольчик (system_notifications с href).
 * Всё через service_role: админ читает чужие обращения, а писать в таблицы
 * клиенту нельзя вовсе (см. миграцию).
 */

interface ThreadRow {
  id: string;
  user_id: string;
  section: string;
  status: 'open' | 'closed';
  created_at: string;
  last_message_at: string;
  user_unread: boolean;
  admin_unread: boolean;
}

interface MessageRow {
  id: string;
  thread_id: string;
  from_admin: boolean;
  body: string;
  created_at: string;
}

/** id админов: ADMIN_EMAILS → пользователи (как в кроне Vibix). */
export async function getAdminUserIds(): Promise<string[]> {
  const { data, error } = await createServiceClient().auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error || !data) return [];
  return data.users.filter((u) => u.email && ADMIN_EMAILS.includes(u.email)).map((u) => u.id);
}

async function toViews(
  threads: ThreadRow[],
  forAdmin: boolean,
): Promise<FeedbackThreadView[]> {
  if (threads.length === 0) return [];
  const supabase = createServiceClient();
  const ids = threads.map((t) => t.id);
  const { data: messages } = await supabase
    .from('feedback_messages')
    .select('id, thread_id, from_admin, body, created_at')
    .in('thread_id', ids)
    .order('created_at', { ascending: true });

  const byThread = new Map<string, MessageRow[]>();
  for (const m of (messages ?? []) as MessageRow[]) {
    const list = byThread.get(m.thread_id) ?? [];
    list.push(m);
    byThread.set(m.thread_id, list);
  }

  // Ящику админа — имя и почта автора: по ним видно, кому отвечаешь.
  const authors = new Map<string, { name: string; email: string | null }>();
  if (forAdmin) {
    const userIds = [...new Set(threads.map((t) => t.user_id))];
    const [{ data: profiles }, { data: users }] = await Promise.all([
      supabase.from('profiles').select('user_id, display_name').in('user_id', userIds),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    const names = new Map(
      ((profiles ?? []) as { user_id: string; display_name: string | null }[]).map((p) => [p.user_id, p.display_name]),
    );
    for (const u of users?.users ?? []) {
      if (!userIds.includes(u.id)) continue;
      authors.set(u.id, { name: names.get(u.id) || u.email?.split('@')[0] || 'Пользователь', email: u.email ?? null });
    }
  }

  return threads.map((t) => ({
    id: t.id,
    section: t.section,
    status: t.status,
    createdAt: t.created_at,
    lastMessageAt: t.last_message_at,
    unread: forAdmin ? t.admin_unread : t.user_unread,
    author: forAdmin
      ? { id: t.user_id, ...(authors.get(t.user_id) ?? { name: 'Пользователь', email: null }) }
      : null,
    messages: (byThread.get(t.id) ?? []).map((m) => ({
      id: m.id,
      fromAdmin: m.from_admin,
      body: m.body,
      createdAt: m.created_at,
    })),
  }));
}

/** Обращения человека — для вкладки «Обратная связь». */
export async function getUserFeedback(userId: string): Promise<FeedbackThreadView[]> {
  try {
    const { data } = await createServiceClient()
      .from('feedback_threads')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false })
      .limit(50);
    return await toViews((data ?? []) as ThreadRow[], false);
  } catch {
    return [];
  }
}

/** Все обращения — ящик админа: открытые и свежие сверху. */
export async function getFeedbackInbox(): Promise<FeedbackThreadView[]> {
  try {
    const { data } = await createServiceClient()
      .from('feedback_threads')
      .select('*')
      .order('status', { ascending: false })
      .order('last_message_at', { ascending: false })
      .limit(100);
    return await toViews((data ?? []) as ThreadRow[], true);
  } catch {
    return [];
  }
}

/** Уведомление в колокольчик. key — дедуп по сообщению. */
export async function notifyFeedback(params: {
  recipients: string[];
  messageId: string;
  threadId: string;
  section: string;
  body: string;
  forAdmin: boolean;
}): Promise<void> {
  if (params.recipients.length === 0) return;
  const snippet = params.body.length > 140 ? `${params.body.slice(0, 139)}…` : params.body;
  const rows = params.recipients.map((userId) => ({
    user_id: userId,
    key: `feedback:${params.messageId}`,
    title: params.forAdmin
      ? `Обращение: ${feedbackSectionLabel(params.section)}`
      : 'Ответ на ваше обращение',
    message: snippet,
    href: feedbackHref(params.threadId, params.forAdmin),
  }));
  const { error } = await createServiceClient()
    .from('system_notifications')
    .upsert(rows, { onConflict: 'user_id,key', ignoreDuplicates: true });
  if (error) console.error('[feedback] уведомление не записалось:', error.message);
}

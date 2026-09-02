import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminResetPasswordCard from '@/components/AdminResetPasswordCard';
import AdminUserTabs from '@/components/AdminUserTabs';
import { isAdminEmail } from '@/lib/admin';
import { getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { UserListItem, WatchedEpisode } from '@/lib/types';

export const metadata = { title: 'Профиль пользователя — MediaWatch' };

/**
 * Список и история просмотра пользователя глазами админа (см.
 * AdminUserTabs.tsx — те же UserListView/HistoryView, что и в собственном
 * профиле). ТОЛЬКО чтение: сервисный клиент (обходит RLS, чужие данные
 * иначе не прочитать) — но никаких мутаций отсюда не выполняется,
 * UserListView получает readOnly, чтобы даже случайный клик не ушёл на
 * update/delete (это списало бы статус/убрало бы тайтл у чужого аккаунта).
 * Доступ — как и /code, только ADMIN_EMAILS, остальным notFound(), см.
 * lib/admin.ts.
 */
export default async function AdminUserProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const {
    data: { user: viewer },
  } = await getCachedUser();

  if (!isAdminEmail(viewer?.email)) {
    notFound();
  }

  const service = createServiceClient();
  const [{ data: targetUser, error: userError }, { data: listData }, { data: historyData }] =
    await Promise.all([
      service.auth.admin.getUserById(params.id),
      service
        .from('user_list')
        .select('*')
        .eq('user_id', params.id)
        .order('created_at', { ascending: false }),
      service
        .from('watched_episodes')
        .select('*')
        .eq('user_id', params.id)
        .order('watched_at', { ascending: false })
        .limit(200),
    ]);

  if (userError || !targetUser?.user) {
    notFound();
  }

  const items = (listData ?? []) as UserListItem[];
  const history = (historyData ?? []) as WatchedEpisode[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-gray-400 transition hover:text-white">
          ← На главную
        </Link>
        <h1 className="mt-1 text-xl font-bold">{targetUser.user.email}</h1>
        <p className="text-sm text-gray-400">
          Список и история пользователя — только просмотр, изменить отсюда ничего нельзя.
        </p>
      </div>

      <AdminResetPasswordCard userId={params.id} />

      <AdminUserTabs items={items} history={history} />
    </div>
  );
}

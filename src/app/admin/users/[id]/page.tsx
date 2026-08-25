import Link from 'next/link';
import { notFound } from 'next/navigation';
import UserListView from '@/components/UserListView';
import { isAdminEmail } from '@/lib/admin';
import { getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { UserListItem } from '@/lib/types';

export const metadata = { title: 'Профиль пользователя — MediaWatch' };

/**
 * Список пользователя глазами админа — что запланировал, что смотрит и т.д.
 * (см. UserListView, тот же компонент, что и в собственном профиле).
 * ТОЛЬКО чтение: сервисный клиент (обходит RLS, чужие данные иначе не
 * прочитать) — но никаких мутаций отсюда не выполняется, а UserListView
 * получает readOnly, чтобы даже случайный клик не ушёл на update/delete
 * (это списало бы статус/убрало бы тайтл у чужого аккаунта). Доступ — как
 * и /code, только ADMIN_EMAILS, остальным notFound(), см. lib/admin.ts.
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
  const [{ data: targetUser, error: userError }, { data: listData }] = await Promise.all([
    service.auth.admin.getUserById(params.id),
    service
      .from('user_list')
      .select('*')
      .eq('user_id', params.id)
      .order('created_at', { ascending: false }),
  ]);

  if (userError || !targetUser?.user) {
    notFound();
  }

  const items = (listData ?? []) as UserListItem[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-gray-400 transition hover:text-white">
          ← На главную
        </Link>
        <h1 className="mt-1 text-xl font-bold">{targetUser.user.email}</h1>
        <p className="text-sm text-gray-400">
          Список пользователя — только просмотр, изменить отсюда ничего нельзя.
        </p>
      </div>

      <UserListView items={items} readOnly />
    </div>
  );
}

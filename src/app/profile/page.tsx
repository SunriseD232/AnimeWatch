import { redirect } from 'next/navigation';
import UserListView from '@/components/UserListView';
import TelegramSettings from '@/components/TelegramSettings';
import { createClient } from '@/lib/supabase/server';
import type { UserListItem } from '@/lib/types';

export const metadata = { title: 'Профиль — MediaWatch' };

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Подстраховка (основная защита — в middleware).
  if (!user) redirect('/login?redirect=/profile');

  const { data } = await supabase
    .from('user_list')
    .select('*')
    .order('created_at', { ascending: false });

  const items = (data ?? []) as UserListItem[];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Профиль</h1>
          <p className="text-sm text-gray-400">{user.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-white/10 bg-bg-card px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-red-950/60 hover:text-red-200"
          >
            Выйти
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Мой список</h2>
        <UserListView items={items} />
      </section>

      <TelegramSettings />
    </div>
  );
}

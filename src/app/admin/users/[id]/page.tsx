import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminResetPasswordCard from '@/components/AdminResetPasswordCard';
import AdminUserTabs from '@/components/AdminUserTabs';
import { isAdminEmail } from '@/lib/admin';
import { getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCinemaSeasonCountMap } from '@/lib/videoseed-catalog';
import type { UserListItem, WatchedEpisode, WatchProgress } from '@/lib/types';

export const metadata = { title: 'Профиль пользователя — MediaWatch' };

/**
 * Список, история и «Продолжить просмотр» пользователя глазами админа (см.
 * AdminUserTabs.tsx — те же UserListView/HistoryView/ContinueCard, что и в
 * собственном профиле/на главной). ТОЛЬКО чтение: сервисный клиент (обходит
 * RLS, чужие данные иначе не прочитать) — но никаких мутаций отсюда не
 * выполняется, UserListView/ContinueCard получают readOnly, чтобы даже
 * случайный клик не ушёл на update/delete (это списало бы статус/убрало бы
 * тайтл у чужого аккаунта). «Продолжить просмотр» — только для админа: в
 * собственном профиле пользователя (см. app/profile/page.tsx) этой вкладки
 * нет вовсе, там для этого уже есть карусель на главной/в разделе кино.
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
  const [
    { data: targetUser, error: userError },
    { data: listData },
    { data: historyData },
    { data: progressData },
  ] = await Promise.all([
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
    // «Продолжить просмотр» глазами админа — см. AdminUserTabs, вкладка
    // «Продолжить просмотр». Только чтение: сервисный клиент, никаких
    // мутаций отсюда (см. ContinueCard.readOnly ниже) — исключительно для
    // разбора жалоб вида «у меня прогресс не сохраняется».
    service
      .from('watch_progress')
      .select('*')
      .eq('user_id', params.id)
      .order('updated_at', { ascending: false })
      .limit(24),
  ]);

  if (userError || !targetUser?.user) {
    notFound();
  }

  const items = (listData ?? []) as UserListItem[];
  const history = (historyData ?? []) as WatchedEpisode[];
  const progress = (progressData ?? []) as WatchProgress[];

  // Число сезонов на карточку (см. ContinueCard.isMultiSeason) — та же
  // логика, что и в cinema/page.tsx ContinueWatching, только источник id —
  // прогресс ЦЕЛЕВОГО пользователя, а не текущего админа. Map не передаём
  // клиентскому компоненту напрямую (AdminUserTabs — 'use client') — сразу
  // разворачиваем в плоский массив, который точно сериализуется как проп.
  const cinemaIds = progress
    .filter((p) => p.content_type === 'cinema')
    .map((p) => p.shikimori_id);
  const seasonCountMap = await getCinemaSeasonCountMap(cinemaIds);
  const progressWithSeasons = progress.map((p) => ({
    progress: p,
    isMultiSeason: (seasonCountMap.get(p.shikimori_id) ?? 0) > 1,
  }));

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

      <AdminUserTabs items={items} history={history} continueWatching={progressWithSeasons} />
    </div>
  );
}

import { redirect } from 'next/navigation';
import ChangePasswordButton from '@/components/ChangePasswordButton';
import ProfileTabs from '@/components/ProfileTabs';
import VibixTrialStatus from '@/components/VibixTrialStatus';
import RelayToggle from '@/components/RelayToggle';
import KodikPlayerToggle from '@/components/KodikPlayerToggle';
import ThemeSettings from '@/components/ThemeSettings';
import { isAdminEmail } from '@/lib/admin';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { getTodaysSignupCode } from '@/lib/signupCode';
import { getVpsRelayEnabled, getKodikPlayerEnabled } from '@/lib/settings';
import { normalizeTheme } from '@/lib/theme';
import type { UserListItem, WatchedEpisode } from '@/lib/types';

export const metadata = { title: 'Профиль — MediaWatch' };

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  // Подстраховка (основная защита — в middleware).
  if (!user) redirect('/login?redirect=/profile');

  const [{ data }, { data: history }, { data: themeRow }] = await Promise.all([
    supabase
      .from('user_list')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('watched_episodes')
      .select('*')
      .order('watched_at', { ascending: false })
      .limit(200),
    // Тема пользователя — рендерим настройки сразу с сохранёнными
    // значениями, без промежуточного запроса с клиента (см. lib/theme.ts).
    supabase.from('user_theme').select('accent, palette').eq('user_id', user.id).maybeSingle(),
  ]);

  const items = (data ?? []) as UserListItem[];
  const historyItems = (history ?? []) as WatchedEpisode[];
  const isAdmin = isAdminEmail(user.email);
  const relayEnabled = isAdmin ? await getVpsRelayEnabled(true) : false;
  const kodikPlayerEnabled = isAdmin ? await getKodikPlayerEnabled(true) : false;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Профиль</h1>
          <p className="text-sm text-gray-400">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <ChangePasswordButton />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-white/10 bg-bg-card px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-red-950/60 hover:text-red-200"
            >
              Выйти
            </button>
          </form>
        </div>
      </section>

      {isAdmin && <VibixTrialStatus />}
      <ThemeSettings initialTheme={normalizeTheme(themeRow)} />

      {isAdmin && <RelayToggle initialEnabled={relayEnabled} />}
      {isAdmin && <KodikPlayerToggle initialEnabled={kodikPlayerEnabled} />}

      <ProfileTabs
        items={items}
        history={historyItems}
        showCodeTab={isAdmin}
        code={isAdmin ? getTodaysSignupCode() : null}
      />
    </div>
  );
}

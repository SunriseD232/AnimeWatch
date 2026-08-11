import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOnlineUserCount, isAdminEmail } from '@/lib/admin';
import CalendarLink from './CalendarLink';
import NotificationBell from './NotificationBell';
import SearchBox from './SearchBox';
import SiteLogoLink from './SiteLogoLink';
import TipsLink from './TipsLink';
import UserPresenceBadge from './UserPresenceBadge';
import type { AppNotification } from '@/lib/types';

export default async function Navbar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAdmin = isAdminEmail(user?.email);
  // Только счётчик тут — дешёвый count, без admin.listUsers (см.
  // getOnlineUserCount в lib/admin.ts про то, почему это важно: тяжёлая
  // версия на каждом рендере шапки заметно тормозила весь сайт админу).
  const onlineCount = isAdmin ? await getOnlineUserCount() : null;

  let notifications: AppNotification[] = [];
  if (user) {
    // Системные уведомления (например, Vibix trial) видят только админы —
    // но это уже гарантирует RLS на стороне system_notifications, здесь
    // фильтровать не нужно: у обычного пользователя там просто нет строк.
    const [{ data: episodeRows }, { data: systemRows }] = await Promise.all([
      supabase
        .from('episode_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('system_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const episodeNotifications: AppNotification[] = (episodeRows ?? []).map(
      (row) => ({ ...row, kind: 'episode' as const }),
    );
    const systemNotifications: AppNotification[] = (systemRows ?? []).map(
      (row) => ({ ...row, kind: 'system' as const }),
    );

    notifications = [...episodeNotifications, ...systemNotifications].sort(
      (a, b) => b.created_at.localeCompare(a.created_at),
    );
  }

  return (
    <header className="glass sticky top-0 z-40 border-b border-white/[0.06]">
      <nav className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <SiteLogoLink />

        <div className="flex-1">
          <SearchBox />
        </div>

        {user ? (
          <div className="flex shrink-0 items-center gap-1">
            {onlineCount !== null && (
              <div className="hidden sm:block">
                <UserPresenceBadge onlineCount={onlineCount} />
              </div>
            )}
            <CalendarLink />
            <TipsLink />
            <NotificationBell initial={notifications} />
            <Link
              href="/profile"
              className="press rounded-full px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5 hover:text-white"
            >
              Профиль
            </Link>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <TipsLink />
            <Link
              href="/login"
              className="press rounded-full px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5 hover:text-white"
            >
              Вход
            </Link>
            <Link
              href="/signup"
              className="press rounded-full bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
            >
              Регистрация
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}

import Link from 'next/link';
import { cookies } from 'next/headers';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { MODE_COOKIE, normalizeMode } from '@/lib/mode';
import { getOnlineUserCount, isAdminEmail } from '@/lib/admin';
import CalendarLink from './CalendarLink';
import NotificationBell from './NotificationBell';
import MobileDock from './MobileDock';
import SearchBox from './SearchBox';
import SiteLogoLink from './SiteLogoLink';
import TipsLink from './TipsLink';
import UserPresenceBadge from './UserPresenceBadge';
import Avatar from './social/Avatar';
import { countIncomingRequests, getPublicUsers, toPublicUser } from '@/lib/social/server';
import type { PublicUser } from '@/lib/social/types';
import type { AppNotification, SocialNotification } from '@/lib/types';

export default async function Navbar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  const isAdmin = isAdminEmail(user?.email);
  // Последний открытый раздел — логотипу, чтобы он вёл туда же (lib/mode.ts).
  // Читаем на сервере: клиент возьмёт то же значение пропом и не разойдётся
  // с разметкой при гидратации.
  const cookieMode = normalizeMode(cookies().get(MODE_COOKIE)?.value);
  // Только счётчик тут — дешёвый count, без admin.listUsers (см.
  // getOnlineUserCount в lib/admin.ts про то, почему это важно: тяжёлая
  // версия на каждом рендере шапки заметно тормозила весь сайт админу).
  const onlineCount = isAdmin ? await getOnlineUserCount() : null;

  let notifications: AppNotification[] = [];
  let me: PublicUser | null = null;
  let incomingRequests = 0;
  if (user) {
    // Системные уведомления (например, Vibix trial) видят только админы —
    // но это уже гарантирует RLS на стороне system_notifications, здесь
    // фильтровать не нужно: у обычного пользователя там просто нет строк.
    const [{ data: episodeRows }, { data: systemRows }, { data: profileRow }, incoming, { data: socialRows }] = await Promise.all([
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
      // Аватар в шапке и точка «есть заявки в друзья» — оба запроса по
      // индексу и на одного пользователя, шапку они не замедляют.
      supabase
        .from('profiles')
        .select('user_id, display_name, avatar_path')
        .eq('user_id', user.id)
        .maybeSingle(),
      countIncomingRequests(supabase, user.id),
      // Заявки в друзья и ответы на комментарии (миграция 0037).
      supabase
        .from('social_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    me = toPublicUser(user.id, profileRow);
    incomingRequests = incoming;

    const episodeNotifications: AppNotification[] = (episodeRows ?? []).map(
      (row) => ({ ...row, kind: 'episode' as const }),
    );
    const systemNotifications: AppNotification[] = (systemRows ?? []).map(
      (row) => ({ ...row, kind: 'system' as const }),
    );

    const socialList = (socialRows ?? []) as (Omit<SocialNotification, 'kind' | 'type' | 'actor'> & {
      kind: SocialNotification['type'];
      actor_id: string | null;
    })[];
    const actors = await getPublicUsers(
      supabase,
      socialList.map((row) => row.actor_id).filter((a): a is string => !!a),
    );
    const socialNotifications: AppNotification[] = socialList.map(({ kind, actor_id, ...row }) => {
      const actor = actor_id ? actors.get(actor_id) : undefined;
      return {
        ...row,
        kind: 'social' as const,
        type: kind,
        actor: actor ? { id: actor.id, name: actor.name, avatarUrl: actor.avatarUrl } : null,
      };
    });

    notifications = [...episodeNotifications, ...systemNotifications, ...socialNotifications].sort(
      (a, b) => b.created_at.localeCompare(a.created_at),
    );
  }

  // pt с безопасной зоной — на самой шапке, а не на body: липкая шапка
  // прилипает к нулю вьюпорта, и с отступом на body её содержимое при
  // прокрутке уезжало под часы и заряд на iPhone. Своим фоном она эту зону
  // закрывает, а контент внутри остаётся ниже выреза.
  return (
    <>
      <header className="glass sticky top-0 z-40 border-b border-white/[0.06] pt-[env(safe-area-inset-top)]">
      <nav className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <SiteLogoLink cookieMode={cookieMode} />

        {/* Поиск — только вошедшим. Гостю на /login и /signup он не нужен:
            все результаты ведут на страницы за авторизацией, то есть каждый
            клик отправлял бы обратно на форму входа. Пустой flex-1 остаётся
            распоркой, иначе кнопки входа съезжают к логотипу. */}
        <div className="flex-1">{user && <SearchBox />}</div>

        {user ? (
          <div className="flex shrink-0 items-center gap-1">
            {onlineCount !== null && <UserPresenceBadge onlineCount={onlineCount} />}
            {/* Календарь и подсказки — со всех экранов кроме самых узких:
                на телефоне их место занял поиск, а сами они доступны из
                профиля. */}
            <div className="hidden md:flex md:items-center md:gap-1">
              <CalendarLink />
              <TipsLink />
            </div>
            <NotificationBell initial={notifications} userId={user.id} />
            {/* Иконка вместо слова: подпись «Профиль» занимала в шапке
                больше места, чем колокольчик с календарём вместе взятые, а
                человечек читается без пояснений. На телефоне ссылки тут нет
                вовсе — профиль переехал в нижний док (MobileDock). */}
            <Link
              href="/profile"
              aria-label={incomingRequests > 0 ? `Профиль, заявок в друзья: ${incomingRequests}` : 'Профиль'}
              title="Профиль"
              className="press relative hidden h-9 w-9 place-items-center rounded-full text-gray-300 transition hover:bg-white/5 hover:text-white md:grid"
            >
              {me?.avatarUrl ? (
                <Avatar user={me} size="sm" />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 fill-none stroke-current"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
                </svg>
              )}
              {incomingRequests > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg"
                />
              )}
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
              className="press rounded-full bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:bg-accent-hover"
            >
              Регистрация
            </Link>
          </div>
        )}
      </nav>
      </header>

      {/* Нижний док — только вошедшим и только на телефоне: гостю на форме
        входа некуда по нему ходить. */}
      {user && <MobileDock cookieMode={cookieMode} hasFriendRequests={incomingRequests > 0} />}
    </>
  );
}

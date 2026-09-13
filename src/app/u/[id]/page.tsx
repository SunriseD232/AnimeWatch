import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Avatar from '@/components/social/Avatar';
import FriendButton from '@/components/social/FriendButton';
import PublicListView from '@/components/social/PublicListView';
import RatingsView from '@/components/social/RatingsView';
import { getLocalPosterMap } from '@/lib/posterCacheServer';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  UUID_RE,
  getFriendshipState,
  getPrivacy,
  getUserRatings,
  getVisibleList,
  toPublicUser,
} from '@/lib/social/server';
import type { FriendshipState, Visibility } from '@/lib/social/types';

export const metadata = { title: 'Профиль зрителя — MediaWatch' };

/**
 * Страница другого человека: имя, аватар, дружба, его список и оценки — в
 * пределах того, что он разрешил (вкладка «Приватность», миграция 0037).
 *
 * Что показывать, решает база: оценки отфильтрует RLS, список отдаст только
 * функция get_visible_user_list. Настройки приватности страница читает лишь
 * затем, чтобы вместо пустоты написать, почему пусто.
 */
export default async function UserPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const id = params.id.toLowerCase();

  const {
    data: { user: me },
  } = await getCachedUser();
  if (!me) redirect(`/login?redirect=/u/${id}`);
  if (me.id === id) redirect('/profile');

  const supabase = createClient();
  const [{ data: profile }, state, privacy, list, ratings] = await Promise.all([
    supabase.from('profiles').select('user_id, display_name, avatar_path').eq('user_id', id).maybeSingle(),
    getFriendshipState(supabase, me.id, id),
    getPrivacy(supabase, id),
    getVisibleList(supabase, id),
    getUserRatings(supabase, id),
  ]);

  // Строки профиля может не быть (имя не задавал) — тогда убеждаемся, что
  // такой пользователь вообще существует, иначе на любой id рисовалась бы
  // страница «Зрителя XXXX».
  if (!profile && state === 'none') {
    const { data, error } = await createServiceClient().auth.admin.getUserById(id);
    if (error || !data?.user) notFound();
  }

  const person = toPublicUser(id, profile);
  const canSee = (level: Visibility) => level === 'everyone' || (level === 'friends' && state === 'friends');
  const localPosters = await getLocalPosterMap([
    ...list.map((i) => ({ kind: i.contentType, id: i.shikimoriId })),
    ...ratings.map((r) => ({
      kind: r.contentType === 'cinema' ? ('cinema' as const) : ('anime' as const),
      id: r.shikimoriId,
    })),
  ]);
  const posters = Object.fromEntries(localPosters);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
        <Avatar user={person} size="xl" className="ring-1 ring-white/10" />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 sm:items-start">
          <h1 className="max-w-full text-3xl font-bold leading-tight [overflow-wrap:anywhere] sm:text-4xl">{person.name}</h1>
          <FriendButton userId={id} name={person.name} initialState={state} refreshOnChange />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Список</h2>
        {canSee(privacy.lists) ? (
          <PublicListView items={list} localPosters={posters} />
        ) : (
          <Hidden level={privacy.lists} state={state} singular />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Оценки</h2>
        {canSee(privacy.ratings) ? (
          <RatingsView ratings={ratings} localPosters={posters} emptyText="Оценок пока нет." />
        ) : (
          <Hidden level={privacy.ratings} state={state} singular={false} />
        )}
      </section>

      <p className="text-sm text-gray-400">
        <Link href="/profile?tab=friends" className="text-accent-text hover:underline">
          Ваши друзья и заявки
        </Link>{' '}
        — в профиле, во вкладке «Друзья».
      </p>
    </div>
  );
}

/** Почему раздел пуст: скрыт совсем или открыт только друзьям. */
function Hidden({ level, state, singular }: { level: Visibility; state: FriendshipState; singular: boolean }) {
  const what = singular ? 'Список' : 'Оценки';
  const title =
    level === 'nobody'
      ? `${what} ${singular ? 'скрыт' : 'скрыты'}`
      : `${what} ${singular ? 'виден' : 'видны'} только друзьям`;
  const opens = singular ? 'откроется' : 'откроются';
  const hint =
    level === 'nobody'
      ? 'Человек решил никому это не показывать.'
      : state === 'incoming'
        ? `Примите заявку — и ${singular ? 'он' : 'они'} ${opens}.`
        : state === 'outgoing'
          ? `Когда заявку примут, ${singular ? 'он' : 'они'} ${opens}.`
          : `Добавьте в друзья — когда заявку примут, ${singular ? 'он' : 'они'} ${opens}.`;
  return (
    <div className="rounded-2xl bg-bg-card px-5 py-6 text-sm text-gray-300 ring-1 ring-white/5">
      <p className="font-medium text-gray-100">{title}</p>
      <p className="mt-1">{hint}</p>
    </div>
  );
}

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Avatar from '@/components/social/Avatar';
import FriendButton from '@/components/social/FriendButton';
import RatingsView from '@/components/social/RatingsView';
import { getLocalPosterMap } from '@/lib/posterCacheServer';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  UUID_RE,
  getFriendshipState,
  getUserRatings,
  toPublicUser,
} from '@/lib/social/server';

export const metadata = { title: 'Профиль зрителя — MediaWatch' };

/**
 * Страница другого человека: имя, аватар, дружба и — если вы друзья — его
 * оценки. Сюда ведёт имя под любым комментарием и строка в списке друзей.
 *
 * Оценки фильтрует не эта страница, а RLS title_ratings (миграция 0036): не
 * друзьям запрос просто вернёт пусто. Здесь лишь решаем, что написать
 * вместо списка.
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
  const [{ data: profile }, state] = await Promise.all([
    supabase.from('profiles').select('user_id, display_name, avatar_path').eq('user_id', id).maybeSingle(),
    getFriendshipState(supabase, me.id, id),
  ]);

  // Строки профиля может не быть (имя не задавал) — тогда убеждаемся, что
  // такой пользователь вообще существует, иначе на любой id рисовалась бы
  // страница «Зрителя XXXX».
  if (!profile && state === 'none') {
    const { data, error } = await createServiceClient().auth.admin.getUserById(id);
    if (error || !data?.user) notFound();
  }

  const person = toPublicUser(id, profile);
  const isFriend = state === 'friends';
  const ratings = isFriend ? await getUserRatings(supabase, id) : [];
  const localPosters = isFriend
    ? await getLocalPosterMap(
        ratings.map((r) => ({ kind: r.contentType === 'cinema' ? ('cinema' as const) : ('anime' as const), id: r.shikimoriId })),
      )
    : new Map<string, string>();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
        <Avatar user={person} size="xl" className="ring-1 ring-white/10" />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 sm:items-start">
          <h1 className="max-w-full truncate text-4xl font-bold leading-tight">{person.name}</h1>
          <FriendButton userId={id} name={person.name} initialState={state} refreshOnChange />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Оценки</h2>
        {isFriend ? (
          <RatingsView
            ratings={ratings}
            localPosters={Object.fromEntries(localPosters)}
            emptyText="Оценок пока нет."
          />
        ) : (
          <div className="rounded-2xl bg-bg-card px-5 py-6 text-sm text-gray-300 ring-1 ring-white/5">
            <p className="font-medium text-gray-100">Оценки видны только друзьям</p>
            <p className="mt-1">
              {state === 'incoming'
                ? 'Примите заявку — и увидите, что человек оценил и как.'
                : state === 'outgoing'
                  ? 'Когда заявку примут, здесь появятся оценки.'
                  : 'Добавьте в друзья — когда заявку примут, здесь появятся оценки.'}
            </p>
          </div>
        )}
      </section>

      <p className="text-sm text-gray-400">
        <Link href="/profile" className="text-accent hover:underline">
          Ваши друзья и заявки
        </Link>{' '}
        — в профиле, во вкладке «Друзья».
      </p>
    </div>
  );
}

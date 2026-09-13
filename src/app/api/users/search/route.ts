import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { listFriendships, toPublicUser } from '@/lib/social/server';
import type { FriendshipState, PublicUser } from '@/lib/social/types';

/**
 * GET /api/users/search?q=имя — поиск людей по отображаемому имени.
 *
 * Только по имени: почта не ищется и не возвращается. У кого имени нет, того
 * не найти — зато его можно добавить со страницы профиля, куда ведёт имя
 * под любым комментарием.
 */

const MIN_QUERY = 2;
const LIMIT = 12;

export async function GET(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы искать людей.' }, { status: 401 });

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 32);
  if ([...q].length < MIN_QUERY) return NextResponse.json({ results: [] });

  // % и _ в ilike — подстановочные знаки; экранируем, чтобы «a_b» искало
  // именно «a_b».
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const supabase = createClient();
  const [{ data }, friendships] = await Promise.all([
    supabase
      .from('profiles')
      .select('user_id, display_name, avatar_path')
      .not('display_name', 'is', null)
      .neq('user_id', user.id)
      .ilike('display_name', pattern)
      .order('display_name')
      .limit(LIMIT),
    listFriendships(supabase, user.id),
  ]);

  const states = new Map(friendships.map((f) => [f.user.id, f.state]));
  const results: { user: PublicUser; state: FriendshipState }[] = (data ?? []).map((row) => ({
    user: toPublicUser(row.user_id, row),
    state: states.get(row.user_id) ?? 'none',
  }));

  return NextResponse.json({ results });
}

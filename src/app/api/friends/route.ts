import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { UUID_RE, getFriendshipState } from '@/lib/social/server';

/**
 * POST /api/friends { userId } — «добавить в друзья».
 *   Нет связи — отправляет заявку. Есть встречная заявка ОТ этого человека —
 *   принимает её: двое, нажавшие «добавить» друг на друге, дружат, а не
 *   висят с двумя заявками.
 * DELETE /api/friends { userId } — отозвать заявку, отклонить её или удалить
 *   из друзей: всё это одно действие «убрать связь».
 *
 * Пишет клиент С СЕССИЕЙ: что можно, решает RLS миграции 0036 (заявка только
 * от себя, принять — только адресату). Ответ — новое состояние, чтобы
 * кнопка не угадывала его сама.
 */

async function readTarget(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  return UUID_RE.test(userId) ? userId.toLowerCase() : null;
}

export async function POST(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы добавлять друзей.' }, { status: 401 });

  const target = await readTarget(request);
  if (!target) return NextResponse.json({ error: 'Не понял, кого добавить.' }, { status: 400 });
  if (target === user.id) return NextResponse.json({ error: 'Себя добавить нельзя.' }, { status: 400 });

  const limit = checkRateLimit(`friends:${user.id}`, 30, 10 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Слишком много заявок подряд. Попробуйте позже.' }, { status: 429 });
  }

  const supabase = createClient();
  const state = await getFriendshipState(supabase, user.id, target);

  if (state === 'friends' || state === 'outgoing') {
    return NextResponse.json({ state });
  }

  if (state === 'incoming') {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('requester_id', target)
      .eq('addressee_id', user.id);
    if (error) {
      console.error(`[friends] user=${user.id} accept ${target} failed: ${error.message}`);
      return NextResponse.json({ error: 'Не удалось принять заявку. Попробуйте ещё раз.' }, { status: 500 });
    }
    return NextResponse.json({ state: 'friends' });
  }

  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: user.id, addressee_id: target });
  if (error) {
    // 23503 — нет такого пользователя (внешний ключ на auth.users).
    if (error.code === '23503') {
      return NextResponse.json({ error: 'Такого пользователя нет.' }, { status: 404 });
    }
    // 23505 — встречная заявка появилась между чтением и записью.
    if (error.code === '23505') {
      return NextResponse.json({ state: await getFriendshipState(supabase, user.id, target) });
    }
    console.error(`[friends] user=${user.id} request ${target} failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось отправить заявку. Попробуйте ещё раз.' }, { status: 500 });
  }
  return NextResponse.json({ state: 'outgoing' });
}

export async function DELETE(request: NextRequest) {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'Войдите, чтобы управлять друзьями.' }, { status: 401 });

  const target = await readTarget(request);
  if (!target) return NextResponse.json({ error: 'Не понял, кого убрать.' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${target}),and(requester_id.eq.${target},addressee_id.eq.${user.id})`,
    );
  if (error) {
    console.error(`[friends] user=${user.id} remove ${target} failed: ${error.message}`);
    return NextResponse.json({ error: 'Не удалось убрать из друзей. Попробуйте ещё раз.' }, { status: 500 });
  }
  return NextResponse.json({ state: 'none' });
}

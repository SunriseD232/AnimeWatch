import { NextResponse } from 'next/server';
import { createClient, getCachedUser } from '@/lib/supabase/server';

/**
 * Отметка «я на сайте прямо сейчас» — вызывается PresenceHeartbeat.tsx раз в
 * ~45 секунд, пока вкладка видима. См. миграцию 0021_user_presence.sql и
 * getOnlineUserCount в lib/admin.ts (бейдж «сейчас онлайн» для админов).
 * getCachedUser() (не supabase.auth.getUser() напрямую) — этот эндпоинт
 * самый частый в приложении (раз в 45с на каждую открытую вкладку), поэтому
 * первым выигрывает от getSession() без сетевого похода на каждый вызов,
 * см. комментарий в lib/supabase/server.ts.
 */
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await getCachedUser();

  // Аноним — просто ничего не пишем (сайт и так закрыт для анонимов почти
  // везде, но /login отдаёт эту же разметку с PresenceHeartbeat в layout).
  if (!user) return NextResponse.json({ ok: false }, { status: 200 });

  const { error } = await supabase.from('user_presence').upsert(
    { user_id: user.id, last_seen_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPresenceSummary, isAdminEmail } from '@/lib/admin';

/**
 * Полная сводка «сейчас онлайн / всего» с почтами — намеренно НЕ вызывается
 * при рендере Navbar (это била тяжёлым admin.listUsers по КАЖДОЙ навигации
 * админа, см. коммит, который это исправил). Дёргается лениво, по клику на
 * бейдж, см. UserPresenceBadge.tsx.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const summary = await getPresenceSummary();
  return NextResponse.json(summary);
}

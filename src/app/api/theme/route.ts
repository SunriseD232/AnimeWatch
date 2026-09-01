import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeTheme } from '@/lib/theme';

/**
 * GET/POST /api/theme — персональная тема оформления (см. lib/theme.ts,
 * components/ThemeSettings.tsx, миграция 0024).
 *
 * Пишем от имени пользователя (обычный клиент с его сессией), а НЕ через
 * service_role: строка одна на пользователя и защищена RLS-политиками из
 * миграции — обходить их тут нечего, а лишний доступ в обход RLS в роуте,
 * который дёргает любой авторизованный клиент, — ровно то место, где такие
 * вещи потом и простреливают.
 */

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Неавторизованный — не ошибка, но и не «тема по умолчанию»: вернуть тут
  // DEFAULT_THEME значило бы, что ThemeSync затрёт этим локальный выбор
  // гостя (воспроизведено вживую: выбранный цвет откатывался к синему через
  // мгновение после загрузки). null — «сервер про тему ничего не знает,
  // оставь как есть».
  if (!user) return NextResponse.json({ theme: null });

  const { data } = await supabase
    .from('user_theme')
    .select('accent, palette')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ theme: normalizeTheme(data) });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  // normalizeTheme молча чинит мусор — сюда прилетает то, что набрал
  // color-picker, и падать на этом незачем (см. комментарий в lib/theme.ts).
  const theme = normalizeTheme(body?.theme);

  const { error } = await supabase.from('user_theme').upsert(
    {
      user_id: user.id,
      accent: theme.accent,
      palette: theme.palette,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    console.error('[api/theme] upsert упал:', error.message);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }

  return NextResponse.json({ theme });
}

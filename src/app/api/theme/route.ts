import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeTheme, rowHasBackdrop } from '@/lib/theme';

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
    // '*', а не список колонок: колонка backdrop появилась миграцией 0046, и
    // если код выкатили раньше миграции, явный select упал бы целиком — тема
    // пользователя откатилась бы к синей. Со звёздочкой просто нет фона.
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  // backdropKnown: false — строки нет или в ней нет колонки backdrop (до
  // миграции 0046); клиент тогда оставит свой фон (см. mergeServerTheme).
  return NextResponse.json({ theme: normalizeTheme(data), backdropKnown: rowHasBackdrop(data) });
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

  const row = {
    user_id: user.id,
    accent: theme.accent,
    palette: theme.palette,
    backdrop: theme.backdrop,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from('user_theme').upsert(row, { onConflict: 'user_id' });

  // Код мог выехать раньше миграции 0046 (колонка backdrop). Тогда весь
  // upsert падает на неизвестной колонке, и пользователь не мог бы сохранить
  // даже цвет. Повторяем без фона: акцент и палитра сохранятся, а фон
  // останется только на этом устройстве (localStorage) до миграции.
  let savedBackdrop = true;
  if (error && /backdrop/i.test(error.message)) {
    const { backdrop: _skip, ...legacy } = row;
    ({ error } = await supabase.from('user_theme').upsert(legacy, { onConflict: 'user_id' }));
    savedBackdrop = false;
  }

  if (error) {
    console.error('[api/theme] upsert упал:', error.message);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }

  return NextResponse.json({ theme, savedBackdrop });
}

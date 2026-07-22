import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/telegram';

/**
 * POST /api/telegram/link
 * Тело: { telegram_id }
 * Начинает верификацию: генерирует код и шлёт его напрямую через Telegram
 * Bot API (sendMessage, BOT_TOKEN) на переданный telegram_id — подтверждает,
 * что пользователь реально владеет этим аккаунтом (получить сообщение может
 * только тот, кто уже написал боту /start). Код в HTTP-ответ не попадает.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { telegram_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const tgId = String(body.telegram_id ?? '').trim();
  if (!tgId || !/^\d+$/.test(tgId)) {
    return NextResponse.json({ error: 'invalid telegram_id' }, { status: 400 });
  }

  // Генерируем код подтверждения.
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();

  const { data: verification, error } = await supabase
    .from('telegram_verifications')
    .insert({
      user_id: user.id,
      telegram_id: tgId,
      code,
      status: 'pending',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 минут
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sent = await sendTelegramMessage(
    tgId,
    `Код подтверждения MediaWatch: ${code}\n\nВведите его на сайте в течение 10 минут.`,
  );

  if (!sent) {
    // Не удалось доставить — обычно потому, что пользователь ещё не писал
    // боту /start (Telegram не позволяет ботам писать первыми). Запись
    // без доставленного кода бесполезна, убираем.
    await supabase.from('telegram_verifications').delete().eq('id', verification.id);
    return NextResponse.json({ error: 'telegram_send_failed' }, { status: 400 });
  }

  await supabase
    .from('telegram_verifications')
    .update({ status: 'sent' })
    .eq('id', verification.id);

  return NextResponse.json({ ok: true });
}

/**
 * PUT /api/telegram/link
 * Тело: { telegram_id, code }
 * Подтверждает верификацию и привязывает Telegram ID.
 */
export async function PUT(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { telegram_id?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const tgId = String(body.telegram_id ?? '').trim();
  const code = String(body.code ?? '').trim().toUpperCase();

  if (!tgId || !code) {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  // Ищем верификацию. 'sent' — обычный путь (код доставлен через Telegram);
  // 'pending' оставлен на случай гонки, если update статуса ещё не применился.
  const { data: verification } = await supabase
    .from('telegram_verifications')
    .select('*')
    .eq('user_id', user.id)
    .eq('telegram_id', tgId)
    .eq('code', code)
    .in('status', ['sent', 'pending'])
    .maybeSingle();

  if (!verification) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  if (new Date(verification.expires_at) < new Date()) {
    await supabase
      .from('telegram_verifications')
      .update({ status: 'expired' })
      .eq('id', verification.id);
    return NextResponse.json({ error: 'code_expired' }, { status: 400 });
  }

  // Подтверждаем.
  await supabase
    .from('telegram_verifications')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', verification.id);

  // Создаём или обновляем привязку.
  const { error: upsertError } = await supabase
    .from('telegram_links')
    .upsert({ user_id: user.id, telegram_id: tgId }, { onConflict: 'user_id' });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/telegram/link
 * Удаляет привязку Telegram ID.
 */
export async function DELETE(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('telegram_links')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/telegram/link
 * Возвращает текущую привязку Telegram.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data } = await supabase
    .from('telegram_links')
    .select('telegram_id')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ telegram_id: data?.telegram_id ?? null });
}

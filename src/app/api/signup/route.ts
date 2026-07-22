import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { verifySignupCode } from '@/lib/signupCode';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const IP_LIMIT = 5;
const IP_WINDOW_MS = 60_000;

/**
 * POST /api/signup — регистрация ТОЛЬКО через этот роут, не напрямую с
 * клиента через supabase.auth.signUp(). Причина: anon key публичный по
 * дизайну (NEXT_PUBLIC_*), и если бы код приглашения проверялся только на
 * клиенте, любой мог бы вызвать Supabase signUp напрямую из консоли браузера
 * в обход проверки. Здесь пользователь создаётся через service_role
 * (auth.admin.createUser) — этот путь недоступен без секретного ключа,
 * который никогда не покидает сервер.
 *
 * ВАЖНО: чтобы это давало реальную защиту, а не только на уровне нашего UI,
 * в Supabase Dashboard → Authentication → Settings нужно ОТКЛЮЧИТЬ обычную
 * публичную регистрацию (Allow new users to sign up). Без этого прямой
 * вызов Supabase Auth API в обход нашего роута всё ещё возможен.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`signup:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  let body: { email?: string; password?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json', remaining: rl.remaining }, { status: 400 });
  }

  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  const code = String(body.code ?? '');

  if (!email || password.length < 6) {
    return NextResponse.json(
      { error: 'bad_payload', remaining: rl.remaining },
      { status: 400 },
    );
  }

  if (!verifySignupCode(code)) {
    return NextResponse.json(
      { error: 'invalid_code', remaining: rl.remaining },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // код приглашения — уже достаточное подтверждение
  });

  if (createError) {
    // Supabase возвращает "User already registered" при дубликате — не
    // палим лишних деталей, просто нормальная ошибка формы.
    return NextResponse.json(
      { error: createError.message, remaining: rl.remaining },
      { status: 400 },
    );
  }

  // Сразу логиним через cookie-aware клиент, чтобы пользователь не вводил
  // пароль второй раз сразу после регистрации.
  const supabase = createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return NextResponse.json({ ok: true, autoLoginFailed: true });
  }

  return NextResponse.json({ ok: true });
}

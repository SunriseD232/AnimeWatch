import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const IP_LIMIT = 5;
const IP_WINDOW_MS = 60_000;

/**
 * POST /api/login — вынесен из клиента в сервер ради видимого счётчика
 * попыток и реального rate limiting (5/мин с IP). Каждый вызов считается в
 * лимит независимо от результата — так и должно быть для защиты от перебора
 * пароля.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`login:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: rl.retryAfterMs, remaining: 0 },
      { status: 429 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'bad_json', remaining: rl.remaining },
      { status: 400 },
    );
  }

  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  if (!email || !password) {
    return NextResponse.json(
      { error: 'bad_payload', remaining: rl.remaining },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json(
      { error: error.message, remaining: rl.remaining },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

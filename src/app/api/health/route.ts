import { NextResponse } from 'next/server';

/**
 * Простой health-check для внешнего аптайм-монитора (например, UptimeRobot) —
 * 200 OK без обращения к БД/внешним API, чтобы не плодить лишнюю нагрузку и
 * не давать ложных «down» из-за временной недоступности Shikimori/Videoseed.
 */
export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}

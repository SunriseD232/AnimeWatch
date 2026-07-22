import type { NextRequest } from 'next/server';

/**
 * In-memory sliding window по ключу (обычно IP). Best-effort на serverless
 * Vercel: живёт в рамках одного тёплого инстанса функции, сбрасывается на
 * cold start/другом инстансе — не строгая гарантия, но первая линия защиты
 * от перебора (тот же приём, что и /api/download, см. ARCHITECTURE.md §12.7).
 */
const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  /** Сколько попыток ещё останется, если эта будет засчитана. */
  remaining: number;
  /** Через сколько мс откроется следующая попытка (0, если можно сразу). */
  retryAfterMs: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  const allowed = hits.length < limit;
  if (allowed) {
    hits.push(now);
  }
  buckets.set(key, hits);

  const remaining = Math.max(0, limit - hits.length);
  const retryAfterMs = allowed ? 0 : windowMs - (now - hits[0]);
  return { allowed, remaining, retryAfterMs };
}

/** IP клиента из заголовка, который проставляет Vercel/большинство прокси. */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  );
}

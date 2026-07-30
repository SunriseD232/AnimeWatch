import { NextResponse, type NextRequest } from 'next/server';
import { verifyRawToken, fetchAndProxy } from '@/lib/extract/proxy';

/**
 * GET /api/proxy/raw?u=<payload>&s=<sig>
 *
 * Проксирует один сегмент/суб-плейлист HLS (или mp4-кусок), на который
 * ссылался переписанный плейлист из /api/proxy/.../[source]. Токен u/s
 * подписан HMAC на сервере (см. src/lib/extract/proxy.ts) — без верной
 * подписи запрос отклоняется, иначе эндпоинт превратился бы в открытый
 * прокси на произвольные URL (SSRF).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function handleGet(request: NextRequest, isHeadProbe: boolean): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const resolved = verifyRawToken(searchParams.get('u'), searchParams.get('s'));
  if (!resolved) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let range = request.headers.get('range');
  // Тот же приём, что в /api/proxy/.../[source]/route.ts — HEAD без Range
  // иначе тянет апстрим целиком через relay только чтобы отбросить тело.
  if (isHeadProbe && !range && !resolved.url.includes('.m3u8')) {
    range = 'bytes=0-0';
  }

  return fetchAndProxy(range, resolved.url, resolved.headers);
}

export async function GET(request: NextRequest) {
  try {
    return await handleGet(request, false);
  } catch (err) {
    // Голый платформенный 500 нечем диагностировать — см. тот же приём в
    // /api/proxy/.../[source]/route.ts.
    console.error('[proxy/raw] Необработанная ошибка:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'internal_error', message }, { status: 502 });
  }
}

export async function HEAD(request: NextRequest) {
  try {
    const res = await handleGet(request, true);
    // .cancel() зависал намертво на relay-цепочке — см. тот же приём в
    // /api/proxy/.../[source]/route.ts. Тело уже маленькое (bytes=0-0).
    await res.arrayBuffer().catch(() => {});
    return new Response(null, { status: res.status, headers: res.headers });
  } catch (err) {
    console.error('[proxy/raw] HEAD упал:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'internal_error', message }, { status: 502 });
  }
}

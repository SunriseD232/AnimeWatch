import { NextResponse, type NextRequest } from 'next/server';
import { verifyDashBaseToken, fetchAndProxy } from '@/lib/extract/proxy';

/**
 * GET /api/proxy/dash-seg/[token]/[...segment]
 *
 * Сегменты DASH (Aksor) — не подписываются по одному, как в HLS
 * (rewriteM3U8/signRawUrl): dash.js сам вычисляет имена файлов из
 * SegmentTemplate манифеста (init-stream$RepresentationID$.m4s,
 * chunk-stream$RepresentationID$-$Number%05d$.m4s) и резолвит их
 * ОТНОСИТЕЛЬНО <BaseURL>, которым rewriteDashManifest указал сюда — см.
 * lib/extract/proxy.ts. [token] подписывает саму БАЗОВУЮ директорию (а не
 * конкретный файл), [...segment] — то, что браузер дописал при обычном
 * относительном разрешении URL.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteParams {
  token: string;
  segment: string[];
}

async function handleGet(request: NextRequest, { params }: { params: RouteParams }): Promise<Response> {
  const resolved = verifyDashBaseToken(params.token);
  if (!resolved) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const segment = params.segment ?? [];
  // '..' в имени сегмента ушёл бы за пределы подписанной директории — сама
  // подпись это не открывает (домен/хост зафиксирован), но незачем позволять
  // и такое на всякий случай.
  if (segment.some((s) => s.includes('..'))) {
    return NextResponse.json({ error: 'bad segment' }, { status: 400 });
  }

  const url = resolved.baseDirUrl + segment.map((s) => decodeURIComponent(s)).join('/');
  const range = request.headers.get('range');
  return fetchAndProxy(range, url, resolved.headers);
}

export async function GET(request: NextRequest, ctx: { params: RouteParams }) {
  try {
    return await handleGet(request, ctx);
  } catch (err) {
    console.error('[proxy/dash-seg] Необработанная ошибка:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'internal_error', message }, { status: 502 });
  }
}

export async function HEAD(request: NextRequest, ctx: { params: RouteParams }) {
  try {
    const res = await handleGet(request, ctx);
    // .cancel() зависал намертво на relay-цепочке в других роутах этого же
    // проекта — на всякий случай дочитываем так же, тело сегмента маленькое.
    await res.arrayBuffer().catch(() => {});
    return new Response(null, { status: res.status, headers: res.headers });
  } catch (err) {
    console.error('[proxy/dash-seg] HEAD упал:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'internal_error', message }, { status: 502 });
  }
}

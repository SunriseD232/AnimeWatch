import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';
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

/** Ширины, под которые верстается сетка каталога (см. grid-cols-2..6 в
 *  cinema/page.tsx и соседних страницах) — allowlist, а не произвольное
 *  число из query, чтобы нельзя было заставить sharp ресайзить один и тот
 *  же постер под сотню разных w. */
const ALLOWED_WIDTHS = new Set([240, 320, 480]);

/**
 * Ресайзит постер в WebP под запрошенную ширину (?w=). Раньше постеры
 * (Videoseed и вообще всё, что идёт через этот прокси) отдавались как есть
 * — сырой размер/формат исходного хостинга — а в сетке из 6+ карточек на
 * экран это раздувает трафик. Ресайз дописан прямо сюда (этот роут и так
 * уже проксирует эти URL, см. proxy.ts), а не через next/image — тот уже
 * один раз ломал постеры с shikimori (см. комментарий в CinemaCard.tsx).
 *
 * w сознательно НЕ входит в подписанный HMAC-payload (u/s, см.
 * verifyRawToken) — это не другой URL и не другой апстрим, только размер
 * вывода уже проверенного запроса, секьюрити-последствий у него нет.
 */
async function maybeResizeImage(upstream: Response, widthParam: string | null): Promise<Response> {
  const width = widthParam ? Number(widthParam) : NaN;
  const contentType = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !ALLOWED_WIDTHS.has(width) || !contentType.startsWith('image/')) {
    return upstream;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  try {
    const resized = await sharp(buffer)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return new Response(new Uint8Array(resized), {
      status: upstream.status,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(resized.length),
        'Cache-Control': upstream.headers.get('cache-control') ?? 'public, max-age=604800, immutable',
      },
    });
  } catch (err) {
    // sharp не справился (битые/экзотические байты) — отдаём оригинал,
    // который уже буферизован выше, а не upstream (его тело уже вычитано
    // .arrayBuffer()'ом и будет пустым при повторном использовании).
    console.error('[proxy/raw] sharp resize упал, отдаю оригинал:', err);
    const headers = new Headers(upstream.headers);
    headers.set('Content-Length', String(buffer.length));
    return new Response(new Uint8Array(buffer), { status: upstream.status, headers });
  }
}

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

  const upstream = await fetchAndProxy(range, resolved.url, resolved.headers);
  // Ресайз только для обычных полных запросов картинки — Range-запрос
  // (частичная загрузка/HEAD-проба) отдаём как есть, менять формат под
  // произвольный byte-range технически можно, но незачем.
  if (range) return upstream;
  return maybeResizeImage(upstream, searchParams.get('w'));
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

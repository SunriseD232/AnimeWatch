import { NextResponse, type NextRequest } from 'next/server';
import { getMirrorSourceConfig } from '@/lib/mirror/sources';
import { fetchUpstream } from '@/lib/mirror/upstreamFetch';
import { buildInjectScript, injectIntoHtml } from '@/lib/mirror/injectScript';

/**
 * Зеркало эмбед-страницы источника (Alloha/Videoseed) — см. §12.6
 * ARCHITECTURE.md. Отдаёт HTML/API-ответы источника ТАК, будто это наш
 * собственный домен: реальный браузер посетителя грузит и исполняет JS
 * источника у себя (никакого serverless Chromium), поэтому антибот видит
 * настоящий отпечаток (JS- и TLS-уровня) реального устройства пользователя.
 *
 * Заголовок <head> получает <base href="https://HOST/"> (статика — скрипты,
 * стили, картинки — резолвится и грузится НАПРЯМУЮ с реального домена, без
 * нашего участия) и инжектится скрипт (buildInjectScript), который патчит
 * fetch/XHR: любой запрос, чей resolved-URL указывает на тот же HOST
 * (т.е. страница обращается сама к себе, как /bnsi/movies/{id}), скрипт
 * перенаправляет на путь ЭТОГО ЖЕ зеркала — иначе браузер считает документ
 * (отданный НАШИМ доменом) и такой запрос разными origin и блокирует чтение
 * ответа без CORS-заголовков источника, которых, скорее всего, нет.
 *
 * Сюда же попадает и сам POST /bnsi/movies/{id} (уже переписанный скриптом
 * на путь зеркала) — сервер просто транслирует его апстриму, добавляя
 * Referer, которого ждёт антихотлинк (браузер сам его не пришлёт: с точки
 * зрения браузера запрос same-origin к НАШЕМУ домену, Referer у него — наш
 * URL, а не ожидаемый источником).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'content-length',
  'cookie',
  'origin',
  'referer',
  'accept-encoding',
]);

interface RouteParams {
  source: string;
  path?: string[];
}

async function handle(request: NextRequest, { params }: { params: RouteParams }) {
  const config = getMirrorSourceConfig(params.source);
  if (!config) {
    return NextResponse.json({ error: 'unknown_source' }, { status: 404 });
  }

  const subPath = (params.path ?? []).join('/');
  const targetUrl = `https://${config.host}/${subPath}${request.nextUrl.search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  });
  headers.Referer = config.referer;
  headers['Accept-Encoding'] = 'identity';

  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : Buffer.from(await request.arrayBuffer());

  let upstream;
  try {
    upstream = await fetchUpstream(targetUrl, {
      method: request.method,
      headers,
      body,
      useProxy: config.useProxy,
    });
  } catch (err) {
    console.error(`[mirror] fetchUpstream упал (${targetUrl}):`, err);
    return NextResponse.json({ error: 'upstream_unreachable' }, { status: 502 });
  }

  const contentType = String(upstream.headers['content-type'] ?? '');
  const responseHeaders = new Headers();
  if (contentType) responseHeaders.set('content-type', contentType);
  responseHeaders.set('cache-control', 'private, no-store');
  // Апстрим может прислать свои x-frame-options/CSP — они запретили бы
  // ИМЕННО нашей странице встраивать этот документ в iframe.
  // (x-frame-options/content-security-policy сюда намеренно не копируются.)

  if (contentType.includes('text/html')) {
    const html = upstream.body.toString('utf8');
    const scriptTag = buildInjectScript(`/api/proxy/mirror/${params.source}`, config.host);
    const rewritten = injectIntoHtml(html, scriptTag, `https://${config.host}/`);
    return new NextResponse(rewritten, { status: upstream.status, headers: responseHeaders });
  }

  return new NextResponse(new Uint8Array(upstream.body), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export { handle as GET, handle as POST };

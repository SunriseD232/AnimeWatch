import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Range-прокси байтов апстрима + подписанные "сырые" ссылки для сегментов
 * HLS-плейлиста (см. §12 ARCHITECTURE.md). Браузер никогда не видит
 * реальный домен/URL Alloha или Videoseed — только наш /api/proxy/raw с
 * непрозрачным подписанным токеном, который сервер разворачивает обратно
 * в {url, headers} и умеет проверить, что токен создали мы сами (иначе
 * эндпоинт превратился бы в открытый SSRF-прокси на произвольные URL).
 */

const RAW_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // хватает на любой сеанс просмотра

function secret(): string {
  const s = process.env.PROXY_SIGNING_SECRET;
  if (!s) throw new Error('PROXY_SIGNING_SECRET не задан');
  return s;
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/** Подписывает {url, headers} в опаковый токен для /api/proxy/raw?u=... */
export function signRawUrl(url: string, headers: Record<string, string>): string {
  const payload = base64url(
    JSON.stringify({ u: url, h: headers, exp: Date.now() + RAW_TOKEN_TTL_MS }),
  );
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `/api/proxy/raw?u=${payload}&s=${sig}`;
}

/** Проверяет и разворачивает токен из /api/proxy/raw?u=...&s=... */
export function verifyRawToken(
  payload: string | null,
  sig: string | null,
): { url: string; headers: Record<string, string> } | null {
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('hex');
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const data = JSON.parse(fromBase64url(payload)) as {
      u: string;
      h: Record<string, string>;
      exp: number;
    };
    if (!data.u || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { url: data.u, headers: data.h ?? {} };
  } catch {
    return null;
  }
}

function resolveUrl(base: string, ref: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

/**
 * Переписывает m3u8-плейлист: каждая ссылка на сегмент/суб-плейлист/ключ
 * заменяется на подписанный /api/proxy/raw — так hls.js в браузере ходит
 * только на наш домен, а Referer апстрима подставляет уже сервер.
 */
export function rewriteM3U8(
  text: string,
  baseUrl: string,
  headers: Record<string, string>,
): string {
  return text
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
          const abs = resolveUrl(baseUrl, uri);
          return `URI="${signRawUrl(abs, headers)}"`;
        });
      }
      const abs = resolveUrl(baseUrl, trimmed);
      return signRawUrl(abs, headers);
    })
    .join('\n');
}

function isM3U8(url: string, contentType: string | null): boolean {
  return (
    url.includes('.m3u8') ||
    (contentType ?? '').includes('mpegurl') ||
    (contentType ?? '').includes('x-mpegURL')
  );
}

/**
 * Загружает url (mp4/m3u8/сегмент) у апстрима с нужными заголовками и Range
 * из входящего запроса, отдаёт наружу либо переписанный плейлист (текст),
 * либо байты как есть (потоково, без буферизации).
 */
export async function fetchAndProxy(
  incomingRange: string | null,
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const upstreamHeaders: Record<string, string> = { ...headers };
  if (incomingRange) upstreamHeaders.Range = incomingRange;

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: upstreamHeaders, redirect: 'follow' });
  } catch {
    return new Response(JSON.stringify({ error: 'upstream_unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(JSON.stringify({ error: 'upstream_error', status: upstream.status }), {
      status: upstream.status === 404 ? 404 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentType = upstream.headers.get('content-type');
  if (isM3U8(url, contentType)) {
    const text = await upstream.text();
    const rewritten = rewriteM3U8(text, url, headers);
    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const passHeaders = new Headers();
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(key);
    if (v) passHeaders.set(key, v);
  }
  if (!passHeaders.has('accept-ranges')) passHeaders.set('accept-ranges', 'bytes');
  passHeaders.set('Cache-Control', 'private, no-store');

  return new Response(upstream.body, { status: upstream.status, headers: passHeaders });
}

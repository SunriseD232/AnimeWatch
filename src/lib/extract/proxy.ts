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

/**
 * Kodik отдаёт не один master.m3u8 с ABR-вариантами, а отдельную m3u8-ссылку
 * на каждое качество (см. vps-extractor/src/kodik.js) — синтезируем master
 * сами, чтобы hls.js увидел обычный многоуровневый HLS-стрим (тот же путь,
 * что и для Alloha, когда у неё несколько уровней в master.m3u8). Ссылки на
 * саб-плейлисты подписываем так же, как сегменты в rewriteM3U8 — реальный
 * upstream-домен наружу не уходит.
 */
export function synthesizeMasterPlaylist(
  qualities: { height: number; url: string }[],
  headers: Record<string, string>,
): string {
  const lines = ['#EXTM3U'];
  for (const q of qualities) {
    // Точного битрейта не знаем — грубая оценка по высоте достаточна: нужна
    // лишь для сортировки в auto-режиме hls.js, наш селектор качества всё
    // равно ориентируется на height напрямую.
    const bandwidth = q.height * 2000;
    const width = Math.round((q.height * 16) / 9);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${q.height}`);
    lines.push(signRawUrl(q.url, headers));
  }
  return lines.join('\n');
}

function isM3U8(url: string, contentType: string | null): boolean {
  return (
    url.includes('.m3u8') ||
    (contentType ?? '').includes('mpegurl') ||
    (contentType ?? '').includes('x-mpegURL')
  );
}

/**
 * Некоторые апстримы блокируют IP-диапазоны serverless-платформ (Vercel/
 * AWS) на уровне CDN, а не заголовков — проверено вживую для Sibnet: тот же
 * подписанный URL с теми же Referer/User-Agent даёт 403 с Vercel, но 200/206
 * с обычного IP (включая наш VPS). Для них байты идут через /relay VPS
 * (см. vps-extractor/src/server.js) — Puppeteer там не нужен, только IP.
 */
const RELAY_HOSTS = [
  /(^|\.)sibnet\.ru$/i,
  /(^|\.)okcdn\.ru$/i, // CVH (через cdnvideohub.com) — тот же srcIp-замок у Odnoklassniki.
  /(^|\.)solodcdn\.com$/i, // Kodik — превентивно, не проверяли вживую с Vercel.
];

function needsVpsRelay(url: string): boolean {
  try {
    return RELAY_HOSTS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

async function fetchUpstream(
  url: string,
  upstreamHeaders: Record<string, string>,
): Promise<Response> {
  if (!needsVpsRelay(url)) {
    return fetch(url, { headers: upstreamHeaders, redirect: 'follow' });
  }

  const baseUrl = process.env.VPS_EXTRACTOR_URL;
  const token = process.env.VPS_EXTRACTOR_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('VPS_EXTRACTOR_URL/VPS_EXTRACTOR_TOKEN не заданы — relay недоступен');
  }
  const { Range, ...restHeaders } = upstreamHeaders;
  const relayUrl = new URL('/relay', baseUrl);
  relayUrl.searchParams.set('u', url);
  relayUrl.searchParams.set('h', JSON.stringify(restHeaders));
  return fetch(relayUrl, {
    headers: { Authorization: `Bearer ${token}`, ...(Range ? { Range } : {}) },
  });
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
    upstream = await fetchUpstream(url, upstreamHeaders);
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

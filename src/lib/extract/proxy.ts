import { createHmac, timingSafeEqual } from 'crypto';
import { fetch as wreqFetchImpl } from 'node-wreq';
import { getVpsRelayEnabled } from '@/lib/settings';
import { vlessDispatcher } from '@/lib/net/vlessProxy';

/**
 * Range-прокси байтов апстрима + подписанные "сырые" ссылки для сегментов
 * HLS-плейлиста (см. §12 ARCHITECTURE.md). Браузер никогда не видит
 * реальный домен/URL Alloha или Videoseed — только наш /api/proxy/raw с
 * непрозрачным подписанным токеном, который сервер разворачивает обратно
 * в {url, headers} и умеет проверить, что токен создали мы сами (иначе
 * эндпоинт превратился бы в открытый SSRF-прокси на произвольные URL).
 */

/**
 * Минимальный интерфейс апстрим-ответа, которым реально пользуется
 * fetchAndProxy ниже — общий знаменатель родного fetch()'а (Response из
 * lib.dom) и node-wreq (см. needsFingerprintClient/wreqFetch) — их Response
 * это разные классы, не совместимые номинально, но оба реализуют этот же
 * набор полей/методов, так что структурная типизация TS их обоих сюда
 * пропускает без приведения типов.
 */
interface UpstreamResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

const RAW_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // хватает на любой сеанс просмотра
// Постеры (см. signImageUrl) не живут в рамках одного сеанса просмотра — они
// сохраняются в БД (watch_progress.poster_url, user_list.poster_url) и
// должны открываться и через месяцы. TTL сегментов тут неприменим — токен
// протух бы прямо в «Продолжить просмотр» через несколько часов.
const IMAGE_TOKEN_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

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

function signWithTtl(url: string, headers: Record<string, string>, ttlMs: number): string {
  const payload = base64url(
    JSON.stringify({ u: url, h: headers, exp: Date.now() + ttlMs }),
  );
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `/api/proxy/raw?u=${payload}&s=${sig}`;
}

/** Подписывает {url, headers} в опаковый токен для /api/proxy/raw?u=... */
export function signRawUrl(url: string, headers: Record<string, string>): string {
  return signWithTtl(url, headers, RAW_TOKEN_TTL_MS);
}

/**
 * Подписывает URL картинки (постер) — тот же /api/proxy/raw, но с TTL,
 * рассчитанным на то, что ссылка переживёт БД-запись, а не один сеанс
 * просмотра. Используется там, где postgres хранит постер напрямую с
 * внешнего CDN (см. videoseed-catalog.ts) — проверено вживую 2026-08-23:
 * прямые хотлинки на api.videoseed.tv не грузятся с части клиентских сетей
 * (ERR_TIMED_OUT/ERR_CONNECTION_CLOSED), при этом сама VPS до того же URL
 * достаётся мгновенно — проксирование через собственный сервер решает это
 * так же, как уже решено для видеосегментов.
 */
export function signImageUrl(url: string): string {
  return signWithTtl(url, {}, IMAGE_TOKEN_TTL_MS);
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

function isDashManifest(url: string, contentType: string | null): boolean {
  return url.includes('.mpd') || (contentType ?? '').includes('dash+xml');
}

/**
 * Подписывает БАЗОВУЮ директорию (не конкретный файл) сегментов DASH — в
 * отличие от signRawUrl (один файл на одну подпись), тут один токен на ВСЮ
 * директорию, потому что имена сегментов вычисляет сам dash.js по
 * SegmentTemplate из манифеста ($RepresentationID$/$Number%05d$ и т.п.), а
 * не идут явным списком, как в HLS. Токен — часть URL-ПУТИ (не query), чтобы
 * относительное разрешение <BaseURL> в браузере просто дописывало имя
 * сегмента после него, как обычный path segment.
 */
export function signDashBase(baseDirUrl: string, headers: Record<string, string>): string {
  const payload = base64url(
    JSON.stringify({ u: baseDirUrl, h: headers, exp: Date.now() + RAW_TOKEN_TTL_MS }),
  );
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  // payload — base64url (алфавит без точки), sig — hex (тоже без точки) —
  // разделитель '.' однозначно отделяет одно от другого при разборе.
  return `${payload}.${sig}`;
}

/** Проверяет и разворачивает токен из /api/proxy/dash-seg/[token]/... */
export function verifyDashBaseToken(
  token: string,
): { baseDirUrl: string; headers: Record<string, string> } | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

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
    return { baseDirUrl: data.u, headers: data.h ?? {} };
  } catch {
    return null;
  }
}

/**
 * Переписывает DASH-манифест (.mpd): вставляет <BaseURL> сразу после
 * открывающего <MPD ...>, указывающий на подписанный /api/proxy/dash-seg/ —
 * SegmentTemplate внутри (init-stream$RepresentationID$.m4s,
 * chunk-stream$RepresentationID$-$Number%05d$.m4s у Aksor) остаётся как
 * есть и резолвится браузером/dash.js ОТНОСИТЕЛЬНО этого BaseURL, как того
 * требует спецификация DASH — переписывать каждый сегмент по отдельности
 * (как в HLS) тут не нужно и не нужно знать конкретные имена сегментов.
 */
export function rewriteDashManifest(
  text: string,
  baseUrl: string,
  headers: Record<string, string>,
): string {
  const baseDir = baseUrl.slice(0, baseUrl.lastIndexOf('/') + 1);
  const token = signDashBase(baseDir, headers);
  const proxyBase = `/api/proxy/dash-seg/${token}/`;
  return text.replace(/(<MPD\b[^>]*>)/, `$1<BaseURL>${proxyBase}</BaseURL>`);
}

/**
 * Некоторые апстримы блокируют IP-диапазоны serverless-платформ (Vercel/
 * AWS) на уровне CDN, а не заголовков — проверено вживую для Sibnet: тот же
 * подписанный URL с теми же Referer/User-Agent даёт 403 с Vercel, но 200/206
 * с обычного IP (включая наш VPS). Для них байты идут через /relay VPS
 * (см. vps-extractor/src/server.js) — Puppeteer там не нужен, только IP.
 *
 * Переключается живым флагом из БД (см. lib/settings.ts,
 * components/RelayToggle.tsx в профиле — админ включает/выключает без
 * редеплоя), а не .env: при self-host на самой VPS (см. ARCHITECTURE.md)
 * relay избыточен (приложение и так стучится с "обычного" IP), но при
 * переезде обратно на инфраструктуру с блокируемым IP включается одной
 * кнопкой.
 */
const RELAY_HOSTS = [
  /(^|\.)sibnet\.ru$/i,
  /(^|\.)okcdn\.ru$/i, // CVH (через cdnvideohub.com) — тот же srcIp-замок у Odnoklassniki.
  /(^|\.)solodcdn\.com$/i, // Kodik — превентивно, не проверяли вживую с Vercel.
  /(^|\.)videoseedcdn\.com$/i, // Проверено вживую: тот же URL, что 404 с Vercel, отдаёт 200 с обычного IP.
  /(^|\.)takehost-cdn\.aksor\.tv$/i, // Aksor — превентивно, не проверяли вживую с Vercel.
];

async function needsVpsRelay(url: string): Promise<boolean> {
  if (!(await getVpsRelayEnabled())) return false;
  try {
    return RELAY_HOSTS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

/**
 * Устойчивая передача байт с ЭТОЙ VPS к CDN премиум-линк-сервисов обрывается
 * на ~16KB и дальше зависает намертво — проверено вживую одинаково на
 * AllDebrid и на Real-Debrid, независимо от аккаунта/ключа/торрента, значит
 * дело в сети самой VPS, а не в конкретном сервисе. Через локальный VLESS-
 * туннель (см. lib/net/vlessProxy.ts) та же передача идёт без обрывов —
 * тоже проверено вживую. В отличие от RELAY_HOSTS (переключается флагом из
 * БД для serverless/Vercel), этот список — фиксированное обходное решение
 * под конкретную сеть текущей VPS, включено всегда.
 */
const VLESS_HOSTS = [/(^|\.)download\.real-debrid\.com$/i];

function needsVlessProxy(url: string): boolean {
  try {
    return VLESS_HOSTS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

/**
 * Alloha — конкретно её видео-CDN (vkvideo.cloud) — минимум один edge-сервер
 * жёстко фингерпринтит клиента на TLS/HTTP-уровне: тот же подписанный URL с
 * теми же заголовками — curl получает 200, а обычный fetch() (Node/undici)
 * стабильно и воспроизводимо получает 403 (найдено вживую при разборе
 * жалобы "Alloha иногда не грузится"). Несколько попыток переизвлечь
 * (см. MAX_UPSTREAM_ATTEMPTS в /api/proxy/.../route.ts) НЕ помогают именно
 * для этого класса блокировки — разные извлечения ОДНОГО И ТОГО ЖЕ
 * перевода детерминированно попадают на один и тот же edge, ретрай просто
 * бьётся в него снова.
 *
 * node-wreq (Rust-обёртка над реальным TLS/JA3 конкретного браузера) уже
 * решает точно такую же проблему при ИЗВЛЕЧЕНИИ токенов (см.
 * vps-extractor/src/videoseed-http.js — тот же профиль chrome_147 +
 * http2:false) — здесь тот же приём применён для самой РАЗДАЧИ байт.
 * Проверено вживую (см. коммит): .body — настоящий потоковый ReadableStream,
 * Range/206 отрабатывают побайтово идентично curl — полноценная замена
 * fetch() для этого случая, не только для текстовых ответов.
 */
const FINGERPRINT_CLIENT_HOSTS = [/(^|\.)vkvideo\.cloud$/i];

function needsFingerprintClient(url: string): boolean {
  try {
    return FINGERPRINT_CLIENT_HOSTS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

/** Статический импорт (см. import в начале файла), не динамический — Next.js
 *  standalone-сборка (см. next.config.js output:'standalone') трассирует
 *  зависимости для node_modules/ ТОЛЬКО через статический анализ; проверено
 *  вживую: с `await import('node-wreq')` внутри функции пакет вообще не
 *  попадал в .next/standalone/node_modules — динамический import() с даже
 *  литеральной строкой почему-то не был обнаружен трассировщиком (в отличие
 *  от sharp, у которого статический import уже работал). */
async function wreqFetch(
  url: string,
  headers: Record<string, string>,
): Promise<UpstreamResponse> {
  return wreqFetchImpl(url, {
    headers,
    browser: { profile: 'chrome_147', http2: false, headers: true },
  });
}

async function fetchUpstream(
  url: string,
  upstreamHeaders: Record<string, string>,
): Promise<UpstreamResponse> {
  if (needsFingerprintClient(url)) {
    return wreqFetch(url, upstreamHeaders);
  }

  if (needsVlessProxy(url)) {
    return fetch(url, {
      headers: upstreamHeaders,
      redirect: 'follow',
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: vlessDispatcher(),
    });
  }

  if (!(await needsVpsRelay(url))) {
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

  let upstream: UpstreamResponse;
  try {
    upstream = await fetchUpstream(url, upstreamHeaders);
  } catch (err) {
    console.error(
      `[extract/proxy] fetchUpstream упал url=${url}:`,
      err instanceof Error ? err.message : err,
    );
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
  if (isDashManifest(url, contentType)) {
    const text = await upstream.text();
    const rewritten = rewriteDashManifest(text, url, headers);
    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/dash+xml',
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
  // Постеры (см. signImageUrl) — статичные картинки, безопасно кэшируемые и
  // CDN, и браузером; сегменты видео/остальное — no-store, как раньше (там
  // подписанный URL живёт недолго и может расходиться по Range-запросам).
  passHeaders.set(
    'Cache-Control',
    (contentType ?? '').startsWith('image/') ? 'public, max-age=604800, immutable' : 'private, no-store',
  );

  return new Response(upstream.body, { status: upstream.status, headers: passHeaders });
}

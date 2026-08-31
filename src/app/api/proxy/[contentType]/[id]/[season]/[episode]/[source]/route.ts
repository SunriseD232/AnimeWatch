import { NextResponse, type NextRequest } from 'next/server';
import { resolveStream } from '@/lib/extract/resolve';
import { fetchAndProxy, synthesizeMasterPlaylist } from '@/lib/extract/proxy';
import type { ExtractSource } from '@/lib/extract/types';

/**
 * GET /api/proxy/[contentType]/[id]/[season]/[episode]/[source]
 *
 * Собственный плеер сайта: <video>/hls.js ходит сюда обычными Range-
 * запросами. Сервер (см. §12.6 ARCHITECTURE.md):
 *  1. читает прямую ссылку из кэша (resolved_streams, см.
 *     src/lib/extract/resolve.ts); на промахе кэша синхронно резолвит
 *     через отдельный VPS-сервис (vps-extractor/, см. его README.md) —
 *     единственная подтверждённо рабочая конфигурация против антибота
 *     источников за всё расследование (обычный Puppeteer вне serverless-
 *     песочницы Vercel);
 *  2. если это .mp4 — сразу проксирует запрошенный Range-кусок;
 *  3. если это .m3u8 — переписывает плейлист на подписанные /api/proxy/raw
 *     ссылки (сегменты тоже идут через прокси, с нужным Referer).
 *
 * Ничего не скачивается на диск и не отправляется в Telegram — только
 * потоковая пересылка байт.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// VPS может перебирать несколько эмбед-кандидатов подряд, каждый — секунды
// холодного Chromium — даём запас (см. таймаут самого fetch к VPS в
// vpsExtractor.ts, чуть меньше этого значения).
export const maxDuration = 60;

const ALLOWED_SOURCES = new Set<ExtractSource>([
  'alloha',
  'videoseed',
  'sibnet',
  'kodik',
  'cvh',
  'aksor',
  'realdebrid',
]);

interface RouteParams {
  contentType: string;
  id: string;
  season: string;
  episode: string;
  source: string;
}

/** Aksor отдаёт отдельный .mpd на каждое качество (см. ResolvedStream.qualities
 *  комментарий) — ?q=<height> выбирает нужный, иначе берём resolved.url
 *  (лучшее по умолчанию, как выбрал VPS). */
function pickDashUrl(
  resolved: { url: string; qualities?: { height: number; url: string }[] },
  qHeight: number | undefined,
): string {
  if (qHeight != null) {
    const match = resolved.qualities?.find((q) => q.height === qHeight);
    if (match) return match.url;
  }
  return resolved.url;
}

/** X-Video-Qualities — список доступных высот через запятую, читает клиент
 *  на HEAD-пробе (OwnPlayer.tsx), чтобы построить селектор качества для DASH
 *  без ABR-уровней hls.js (см. rewriteDashManifest — тут одно качество на
 *  манифест, не один multi-variant master). */
function withDashQualities(
  proxied: Response,
  qualities: { height: number; url: string }[] | undefined,
): Response {
  if (!qualities || qualities.length === 0) return proxied;
  const respHeaders = new Headers(proxied.headers);
  respHeaders.set('X-Video-Qualities', qualities.map((q) => q.height).join(','));
  return new Response(proxied.body, { status: proxied.status, headers: respHeaders });
}

async function handleGet(
  request: NextRequest,
  { params }: { params: RouteParams },
  isHeadProbe: boolean,
): Promise<Response> {
  const contentType: 'anime' | 'cinema' = params.contentType === 'cinema' ? 'cinema' : 'anime';
  const shikimoriId = Number(params.id);
  const season = Number(params.season) || 1;
  const episode = Number(params.episode);
  const source = params.source as ExtractSource;

  if (
    !Number.isFinite(shikimoriId) ||
    !Number.isFinite(episode) ||
    !ALLOWED_SOURCES.has(source)
  ) {
    return NextResponse.json({ error: 'bad params' }, { status: 400 });
  }

  // ?t= — id выбранной озвучки (Yummy video_id), см. OwnPlayer/WatchPlayer.
  const tRaw = request.nextUrl.searchParams.get('t');
  const translationId = tRaw != null && Number.isFinite(Number(tRaw)) ? Number(tRaw) : undefined;
  // ?fresh=1 — принудительно обойти кэш resolved_streams. Нужен офлайн-
  // загрузке (см. OfflineDownloadManager.swift): сегменты уже переписаны на
  // подписанные /api/proxy/raw ссылки с ЗАМОРОЖЕННЫМ на момент резолва
  // апстрим-URL — если сам апстрим (например, истёкший токен VK Video CDN)
  // протухает раньше нашего 15-минутного кэша, повторный запрос entryUrl с
  // тем же resolveStream() без forceFresh просто отдаст тот же протухший
  // кэш, и все ретраи сегментов бессмысленно бьются в одну и ту же мёртвую
  // ссылку — проверено вживую 2026-08-23 (1484 502 подряд на 4 сегмента).
  // Обычный веб-плеер сюда не попадает — это ручной opt-in для случая,
  // когда сегмент уже исчерпал собственные ретраи.
  const forceFresh = request.nextUrl.searchParams.get('fresh') === '1';

  // request.signal — отражает реальное отключение клиента (Node.js runtime,
  // см. export const runtime='nodejs' выше). Пробрасываем до extractViaVps
  // (см. resolve.ts/vpsExtractor.ts) — если пользователь ушёл со страницы
  // или переключил серию/озвучку на этапе тяжёлого извлечения (Puppeteer на
  // VPS), не смысла его доводить до конца.
  const resolveArgs = {
    contentType,
    shikimoriId,
    season,
    episode,
    source,
    translationId,
    signal: request.signal,
  };
  const resolved = await resolveStream({ ...resolveArgs, forceFresh });
  if (!resolved) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Kodik отдаёт отдельный m3u8 на каждое качество, а не один master.m3u8 с
  // вариантами (см. ResolvedStream.qualities) — синтезируем master сами,
  // чтобы hls.js/наш селектор качества видели обычный ABR-стрим. Aksor тоже
  // отдаёт качества по одному, но это DASH — обрабатывается отдельной веткой
  // ниже (без synthesizeMasterPlaylist — тот собирает HLS, а не DASH).
  if (!resolved.isDash && resolved.qualities && resolved.qualities.length > 1) {
    const text = synthesizeMasterPlaylist(resolved.qualities, resolved.headers);
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  let range = request.headers.get('range');
  // HEAD (см. ниже) тянет и сразу отбрасывает тело — без явного Range это
  // означало полную загрузку апстрима целиком через relay (проверено вживую:
  // 300-мегабайтный Sibnet-файл — 28с и падение в голый платформенный 500).
  // Для m3u8/DASH-манифеста не трогаем: маленький текст, не все апстримы
  // адекватно отвечают на Range для него.
  if (isHeadProbe && !range && !resolved.isHls && !resolved.isDash) {
    range = 'bytes=0-0';
  }

  if (resolved.isDash) {
    // ?q=<height> — выбор конкретного качества (см. pickDashUrl); каждое
    // качество Aksor — отдельный .mpd в своей директории, не ABR-вариант
    // внутри одного манифеста, поэтому смена качества — новый запрос, а не
    // hls.js-подобное переключение уровня без реолда.
    const qRaw = request.nextUrl.searchParams.get('q');
    const qHeight = qRaw != null && Number.isFinite(Number(qRaw)) ? Number(qRaw) : undefined;
    const dashUrl = pickDashUrl(resolved, qHeight);
    const dashProxied = await fetchAndProxy(range, dashUrl, resolved.headers);
    if (dashProxied.status !== 404) return withDashQualities(dashProxied, resolved.qualities);

    // Та же логика самолечения, что и у остального ниже (см. комментарий у
    // forceFresh) — раньше эта ветка возвращалась ДО общего ретрая, и
    // протухший (раньше 15-минутного TTL resolved_streams) подписанный .mpd
    // Aksor просто падал с 404 без попытки переизвлечь.
    await dashProxied.body?.cancel().catch(() => {});
    const freshDash = await resolveStream({ ...resolveArgs, forceFresh: true });
    if (!freshDash) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const freshDashUrl = pickDashUrl(freshDash, qHeight);
    const retriedDash = await fetchAndProxy(range, freshDashUrl, freshDash.headers);
    return withDashQualities(retriedDash, freshDash.qualities);
  }

  const proxied = await fetchAndProxy(range, resolved.url, resolved.headers);
  if (proxied.status !== 404) return proxied;

  // Кэш мог протухнуть раньше своего TTL — у Videoseed подписанные CDN-
  // ссылки живут заметно меньше 15 минут (проверено вживую: закэшированная
  // ссылка 404'ит у апстрима, при этом свежее извлечение того же тайтла
  // проходит нормально). Раз апстрим ответил, а не молчит — пробуем
  // переизвлечь один раз, прежде чем сдаваться.
  await proxied.body?.cancel().catch(() => {});
  const fresh = await resolveStream({ ...resolveArgs, forceFresh: true });
  if (!fresh) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (fresh.qualities && fresh.qualities.length > 1) {
    const text = synthesizeMasterPlaylist(fresh.qualities, fresh.headers);
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, no-store',
      },
    });
  }
  return fetchAndProxy(range, fresh.url, fresh.headers);
}

export async function GET(request: NextRequest, ctx: { params: RouteParams }) {
  try {
    return await handleGet(request, ctx, false);
  } catch (err) {
    // Ловим ВСЁ (не только resolveStream) — иначе браузер получает голый
    // платформенный 500 без тела, который вообще нечем диагностировать.
    console.error('[proxy] Необработанная ошибка:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'internal_error', message }, { status: 502 });
  }
}

export async function HEAD(request: NextRequest, ctx: { params: RouteParams }) {
  try {
    const res = await handleGet(request, ctx, true);
    // res.body.cancel() зависал намертво (проверено вживую: curl HEAD ждал
    // 25с+ без единого байта) — тело идёт через relay VPS двойным hop'ом
    // (Vercel→VPS→апстрим), и отмена такого сцепленного потока, похоже, не
    // всегда доходит до конца. Тело уже маленькое (см. bytes=0-0 выше) —
    // проще дочитать до конца, чем пытаться его оборвать.
    await res.arrayBuffer().catch(() => {});
    return new Response(null, { status: res.status, headers: res.headers });
  } catch (err) {
    console.error('[proxy] HEAD упал:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'internal_error', message }, { status: 502 });
  }
}

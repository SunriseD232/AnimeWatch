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

/**
 * Стоит ли переизвлечь заново (см. forceFresh-ретраи ниже) вместо того,
 * чтобы сразу отдать клиенту ошибку. Раньше проверялось только `=== 404`
 * (комментарий "у Videoseed подписанные CDN-ссылки живут заметно меньше 15
 * минут") — но у Alloha протухшая подписанная ссылка отдаёт **403**, не 404
 * (проверено вживую: реальный закэшированный URL, ещё "живой" по нашему
 * expires_at, у самого апстрима уже 403) — с проверкой только на 404 это
 * НИКОГДА не ретраилось, протухшая ссылка была мертва до истечения всего
 * 15-минутного кэша resolved_streams, хотя апстрим явно и быстро сигналил
 * об этом. Ретраим на любой неуспех (не только 404/403) — переизвлечение
 * само по себе дешёвая операция при живом апстриме, а хуже, чем отдать ту
 * же ошибку клиенту после неудачной попытки, не станет.
 */
function isRetryableUpstreamFailure(status: number): boolean {
  return status >= 400;
}

// Сколько раз пробовать переизвлечь при неуспехе апстрима, прежде чем
// сдаться — не 1 (было раньше), а до 2-3: найдено вживую, что у Alloha
// РАЗНЫЕ извлечения одного и того же перевода могут попасть на РАЗНЫЕ
// edge-сервера её CDN (vkvideo.cloud, по имени хоста в URL — разный при
// каждом извлечении), и как минимум один такой edge жёстко фингерпринтит
// клиента: тот же подписанный URL с теми же заголовками — `curl` получает
// 200, а `fetch()` из Node (то, чем реально пользуется этот прокси) — 403,
// стабильно и воспроизводимо. Один ретрай мог повторно попасть на тот же
// проблемный edge; несколько попыток увеличивают шанс попасть на рабочий.
const MAX_UPSTREAM_ATTEMPTS = 3;

/** Alloha иногда отдаёт рядом с основной озвучкой ещё аудиодорожки (см.
 *  ResolvedStream.audioTracks) — ?audio=<индекс> подставляет её url вместо
 *  основного. Каждая дорожка — ОДНА ссылка без своего набора качеств (см.
 *  комментарий в alloha.js — переключение ABR-уровня у Alloha ломает
 *  воспроизведение, поэтому качества там не отдаются вообще ни для
 *  основной дорожки, ни для этих) — здесь просто меняем url, headers общие
 *  для всех дорожек одного /bnsi/-ответа (тот же embedOrigin). */
function pickAudioTrackUrl(
  resolved: { url: string; audioTracks?: { label: string; url: string }[] },
  audioIndex: number | undefined,
): string {
  if (audioIndex != null) {
    const track = resolved.audioTracks?.[audioIndex];
    if (track) return track.url;
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
  // ?audio=<индекс> — выбор доп. аудиодорожки (см. ResolvedStream.
  // audioTracks/pickAudioTrackUrl выше) — сейчас реально бывает только у
  // Alloha (напр. "(Japanese) Original" рядом с дублем).
  const audioRaw = request.nextUrl.searchParams.get('audio');
  const audioIndex = audioRaw != null && Number.isFinite(Number(audioRaw)) ? Number(audioRaw) : undefined;
  // ?warm=1 — прогрев СЛЕДУЮЩЕЙ серии заранее (см. WatchPlayer.tsx/
  // Player.tsx, ищет "warm=1" в комментарии), а не видео, которое сейчас
  // реально грузится (тот же роут HEAD-пробуется и OwnPlayer.tsx для
  // качества АКТИВНОГО видео — без этого параметра, остаётся высоким
  // приоритетом). Понижает приоритет в очереди браузера на VPS (см.
  // Args.background в resolve.ts) — прогрев не должен задерживать чей-то
  // настоящий запрос видео.
  const isWarm = request.nextUrl.searchParams.get('warm') === '1';

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
    background: isWarm,
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
    let currentDash = resolved;
    let dashProxied = await fetchAndProxy(range, pickDashUrl(currentDash, qHeight), currentDash.headers);

    // Та же логика самолечения, что и у остального ниже (см. комментарий у
    // MAX_UPSTREAM_ATTEMPTS) — раньше эта ветка возвращалась ДО ретрая
    // вообще, протухший подписанный .mpd Aksor просто падал без попытки
    // переизвлечь.
    for (
      let attempt = 1;
      attempt < MAX_UPSTREAM_ATTEMPTS && isRetryableUpstreamFailure(dashProxied.status);
      attempt++
    ) {
      await dashProxied.body?.cancel().catch(() => {});
      const freshDash = await resolveStream({ ...resolveArgs, forceFresh: true });
      if (!freshDash) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      currentDash = freshDash;
      dashProxied = await fetchAndProxy(range, pickDashUrl(currentDash, qHeight), currentDash.headers);
    }
    return withDashQualities(dashProxied, currentDash.qualities);
  }

  let current = resolved;
  let proxied = await fetchAndProxy(range, pickAudioTrackUrl(current, audioIndex), current.headers);

  // Кэш мог протухнуть раньше своего TTL — подписанные CDN-ссылки живут
  // заметно меньше 15 минут (проверено вживую и у Videoseed — 404 у
  // апстрима, и у Alloha — 403). Раз апстрим ответил, а не молчит — пробуем
  // переизвлечь заново, до MAX_UPSTREAM_ATTEMPTS попыток суммарно (см. её
  // комментарий — у Alloha разные попытки могут попасть на разные edge её
  // CDN, не все одинаково доступны).
  for (let attempt = 1; attempt < MAX_UPSTREAM_ATTEMPTS && isRetryableUpstreamFailure(proxied.status); attempt++) {
    await proxied.body?.cancel().catch(() => {});
    const fresh = await resolveStream({ ...resolveArgs, forceFresh: true });
    if (!fresh) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    current = fresh;
    if (!current.isDash && current.qualities && current.qualities.length > 1) {
      const text = synthesizeMasterPlaylist(current.qualities, current.headers);
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'private, no-store',
        },
      });
    }
    proxied = await fetchAndProxy(range, pickAudioTrackUrl(current, audioIndex), current.headers);
  }
  return proxied;
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

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

const ALLOWED_SOURCES = new Set<ExtractSource>(['alloha', 'videoseed', 'sibnet', 'kodik', 'cvh']);

interface RouteParams {
  contentType: string;
  id: string;
  season: string;
  episode: string;
  source: string;
}

async function handleGet(
  request: NextRequest,
  { params }: { params: RouteParams },
  isHeadProbe: boolean,
): Promise<Response> {
  const contentType = params.contentType === 'cinema' ? 'cinema' : 'anime';
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

  const resolved = await resolveStream({ contentType, shikimoriId, season, episode, source, translationId });
  if (!resolved) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Kodik отдаёт отдельный m3u8 на каждое качество, а не один master.m3u8 с
  // вариантами (см. ResolvedStream.qualities) — синтезируем master сами,
  // чтобы hls.js/наш селектор качества видели обычный ABR-стрим.
  if (resolved.qualities && resolved.qualities.length > 1) {
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
  // Для m3u8 не трогаем: он и так маленький текст, а не все апстримы
  // адекватно отвечают на Range для него.
  if (isHeadProbe && !range && !resolved.isHls) {
    range = 'bytes=0-0';
  }

  return fetchAndProxy(range, resolved.url, resolved.headers);
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
    await res.body?.cancel().catch(() => {});
    return new Response(null, { status: res.status, headers: res.headers });
  } catch (err) {
    console.error('[proxy] HEAD упал:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'internal_error', message }, { status: 502 });
  }
}

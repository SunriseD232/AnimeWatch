import { NextResponse, type NextRequest } from 'next/server';
import { resolveStream } from '@/lib/extract/resolve';
import { fetchAndProxy } from '@/lib/extract/proxy';
import type { ExtractSource } from '@/lib/extract/types';

/**
 * GET /api/proxy/[contentType]/[id]/[season]/[episode]/[source]
 *
 * Собственный плеер сайта: <video>/hls.js ходит сюда обычными Range-
 * запросами. Сервер (см. §12 ARCHITECTURE.md):
 *  1. резолвит прямую ссылку у эмбед-плеера источника (Puppeteer-перехват,
 *     кэшируется в resolved_streams — см. src/lib/extract/resolve.ts);
 *  2. если это .mp4 — сразу проксирует запрошенный Range-кусок;
 *  3. если это .m3u8 — переписывает плейлист на подписанные /api/proxy/raw
 *     ссылки (сегменты тоже идут через прокси, с нужным Referer).
 *
 * Ничего не скачивается на диск и не отправляется в Telegram — только
 * потоковая пересылка байт.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Puppeteer-резолв при холодном кэше занимает секунды — даём запас.
export const maxDuration = 60;

const ALLOWED_SOURCES = new Set<ExtractSource>(['alloha', 'videoseed']);

interface RouteParams {
  contentType: string;
  id: string;
  season: string;
  episode: string;
  source: string;
}

export async function GET(request: NextRequest, { params }: { params: RouteParams }) {
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

  let resolved;
  try {
    resolved = await resolveStream({ contentType, shikimoriId, season, episode, source });
  } catch (err) {
    // Puppeteer/Chromium или Supabase могли упасть — отдаём диагностируемую
    // ошибку вместо голого 500 без тела (как было до этого try/catch).
    console.error('[proxy] resolveStream упал:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'resolve_failed', message }, { status: 502 });
  }
  if (!resolved) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return fetchAndProxy(request.headers.get('range'), resolved.url, resolved.headers);
}

export async function HEAD(request: NextRequest, ctx: { params: RouteParams }) {
  const res = await GET(request, ctx);
  await res.body?.cancel().catch(() => {});
  return new Response(null, { status: res.status, headers: res.headers });
}

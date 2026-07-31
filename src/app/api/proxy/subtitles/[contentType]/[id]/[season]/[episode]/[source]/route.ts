import { NextResponse, type NextRequest } from 'next/server';
import { resolveStream } from '@/lib/extract/resolve';
import { signRawUrl } from '@/lib/extract/proxy';
import type { ExtractSource } from '@/lib/extract/types';

/**
 * GET /api/proxy/subtitles/[contentType]/[id]/[season]/[episode]/[source]
 *
 * Отдельная лёгкая ручка (не встроена в основной /api/proxy/.../[source]):
 * субтитры — не часть m3u8/mp4-потока, а самостоятельные .vtt-файлы (сейчас
 * реально отдаёт только Videoseed, см. vps-extractor/src/videoseed.js) —
 * OwnPlayer запрашивает их отдельно и добавляет <track> в <video>.
 *
 * Использует тот же resolveStream() (кэш-first) — если основной плеер уже
 * зарезолвил эту серию/озвучку, здесь просто попадание в кэш без повторного
 * извлечения на VPS.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_SOURCES = new Set<ExtractSource>(['alloha', 'videoseed', 'sibnet', 'kodik', 'cvh', 'aksor']);

interface RouteParams {
  contentType: string;
  id: string;
  season: string;
  episode: string;
  source: string;
}

export async function GET(request: NextRequest, { params }: { params: RouteParams }) {
  const contentType: 'anime' | 'cinema' = params.contentType === 'cinema' ? 'cinema' : 'anime';
  const shikimoriId = Number(params.id);
  const season = Number(params.season) || 1;
  const episode = Number(params.episode);
  const source = params.source as ExtractSource;

  if (!Number.isFinite(shikimoriId) || !Number.isFinite(episode) || !ALLOWED_SOURCES.has(source)) {
    return NextResponse.json({ subtitles: [] });
  }

  const tRaw = request.nextUrl.searchParams.get('t');
  const translationId = tRaw != null && Number.isFinite(Number(tRaw)) ? Number(tRaw) : undefined;

  try {
    const resolved = await resolveStream({ contentType, shikimoriId, season, episode, source, translationId });
    if (!resolved?.subtitles?.length) {
      return NextResponse.json({ subtitles: [] });
    }
    // Реальный домен Videoseed наружу не отдаём — те же подписанные
    // /api/proxy/raw ссылки, что и для сегментов (см. lib/extract/proxy.ts).
    const subtitles = resolved.subtitles.map((s) => ({
      lang: s.lang,
      label: s.label,
      url: signRawUrl(s.url, resolved.headers),
    }));
    return NextResponse.json({ subtitles });
  } catch (err) {
    console.error('[proxy/subtitles] Упало:', err);
    return NextResponse.json({ subtitles: [] });
  }
}

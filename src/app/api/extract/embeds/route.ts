import { NextResponse, type NextRequest } from 'next/server';
import { getEmbedMirrorPaths } from '@/lib/extract/embeds';
import type { ExtractSource } from '@/lib/extract/types';

/**
 * GET /api/extract/embeds?contentType=&id=&season=&episode=&source=
 *
 * Список путей зеркала (/api/proxy/mirror/...) для клиентского перехвата —
 * см. §12.6 ARCHITECTURE.md. Никакого Puppeteer: просто поход в Yummy
 * (Alloha) или сборка embed-URL по шаблону (Videoseed), обёрнутых в путь
 * зеркала — сырой домен источника клиенту не отдаём вообще.
 */

const ALLOWED_SOURCES = new Set<ExtractSource>(['alloha', 'videoseed']);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shikimoriId = Number(searchParams.get('id'));
  const season = Number(searchParams.get('season')) || 1;
  const episode = Number(searchParams.get('episode'));
  const source = searchParams.get('source') as ExtractSource;

  if (!Number.isFinite(shikimoriId) || !Number.isFinite(episode) || !ALLOWED_SOURCES.has(source)) {
    return NextResponse.json({ error: 'bad params' }, { status: 400 });
  }

  const mirrorPaths = await getEmbedMirrorPaths(source, { shikimoriId, season, episode });
  return NextResponse.json({ mirrorPaths });
}

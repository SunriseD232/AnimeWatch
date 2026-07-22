import { NextResponse, type NextRequest } from 'next/server';
import { getTmdbTrailerByImdbId } from '@/lib/tmdb';

/**
 * GET /api/trailer?imdbId=tt...&season=N
 * Трейлер кино из TMDB (Videoseed его не отдаёт) — ленивая подгрузка по
 * клику на кнопку «Трейлер» на странице тайтла, а не заранее на каждый
 * сезон (сериал может быть на десятки сезонов).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imdbId = searchParams.get('imdbId');
  if (!imdbId) {
    return NextResponse.json({ embedUrl: null });
  }

  const seasonParam = Number(searchParams.get('season'));
  const season = Number.isFinite(seasonParam) && seasonParam > 0 ? seasonParam : undefined;

  const key = await getTmdbTrailerByImdbId(imdbId, season);
  return NextResponse.json({
    embedUrl: key ? `https://www.youtube.com/embed/${key}` : null,
  });
}

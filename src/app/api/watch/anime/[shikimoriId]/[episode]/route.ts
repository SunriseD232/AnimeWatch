import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveAnimeEpisodeSources } from '@/lib/watch/resolveAnimeEpisode';
import type { WatchProgress } from '@/lib/types';

/**
 * GET /api/watch/anime/[shikimoriId]/[episode]?translationId=123
 *
 * Лёгкий эндпоинт для бесшовного переключения серии на клиенте (см.
 * WatchPlayer.tsx switchEpisode) — см. тот же приём и комментарий в
 * api/watch/cinema/.../route.ts. AniLibria сюда не входит — резолвится
 * отдельно на клиенте.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { shikimoriId: string; episode: string } },
) {
  const shikimoriId = Number(params.shikimoriId);
  const episode = Number(params.episode);
  if (!Number.isFinite(shikimoriId) || !Number.isFinite(episode) || episode < 1) {
    return NextResponse.json({ error: 'bad params' }, { status: 400 });
  }

  const translationRaw = request.nextUrl.searchParams.get('translationId');
  const translationId =
    translationRaw != null && Number.isFinite(Number(translationRaw))
      ? Number(translationRaw)
      : null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let resumeFrom: number | null = null;
  if (user) {
    const { data } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('content_type', 'anime')
      .eq('shikimori_id', shikimoriId)
      .maybeSingle();
    const progress = data as WatchProgress | null;
    if (progress && progress.episode === episode) {
      const pos = progress.position_seconds;
      const dur = progress.duration_seconds;
      const nearEnd = dur ? pos / dur > 0.9 : false;
      if (pos >= 5 && !nearEnd) {
        resumeFrom = Math.floor(pos);
      }
    }
  }

  const sources = await resolveAnimeEpisodeSources({
    shikimoriId,
    episode,
    translationId,
    resumeFrom,
  });

  return NextResponse.json({ ...sources, resumeFrom });
}

import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import { resolveCinemaEpisodeSources } from '@/lib/watch/resolveCinemaEpisode';
import type { WatchProgress } from '@/lib/types';

/**
 * GET /api/watch/cinema/[id]/[season]/[episode]?isSerial=1&translationId=123&skipAuth=1
 *
 * Лёгкий эндпоинт для бесшовного переключения серии на клиенте (см.
 * Player.tsx switchEpisode) — отдаёт ТОЛЬКО то, что меняется от серии к
 * серии (в отличие от полной SSR-навигации на cinema/watch/.../page.tsx,
 * которая заново тянет ещё и тайтл-уровневые данные: постер/сезоны/жанры).
 * Vibix сюда не входит — он один на весь тайтл, клиент просто передаёт
 * новые season/episode в уже смонтированный VibixPlayer без похода на сервер.
 *
 * ?skipAuth=1 — пропускает getUser()/резолв resumeFrom целиком (см.
 * DownloadPicker.tsx: ему нужен только список переводов, а не прогресс).
 * Без этого DownloadPicker бил по getUser() на КАЖДУЮ отмеченную серию
 * параллельно при подтверждении — лишняя нагрузка на Supabase Auth именно
 * в те моменты, когда он и так временами подтормаживает (см. проверку
 * прод-инцидента 2026-08-21 — вылетающие сессии совпадали по времени с
 * открытием этой модалки).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; season: string; episode: string } },
) {
  const kinopoiskId = Number(params.id);
  const season = Number(params.season);
  const episode = Number(params.episode);
  if (
    !Number.isFinite(kinopoiskId) ||
    !Number.isFinite(season) ||
    season < 1 ||
    !Number.isFinite(episode) ||
    episode < 1
  ) {
    return NextResponse.json({ error: 'bad params' }, { status: 400 });
  }

  const isSerial = request.nextUrl.searchParams.get('isSerial') === '1';
  const translationRaw = request.nextUrl.searchParams.get('translationId');
  const translationId =
    translationRaw != null && Number.isFinite(Number(translationRaw))
      ? Number(translationRaw)
      : null;
  const skipAuth = request.nextUrl.searchParams.get('skipAuth') === '1';

  let resumeFrom: number | null = null;
  if (!skipAuth) {
    const supabase = createClient();
    const {
      data: { user },
    } = await getCachedUser();

    // Восстановление позиции — только если сохранённый прогресс на ИМЕННО
    // этой серии/сезоне и не у самого конца (та же логика, что в page.tsx).
    if (user) {
      const { data } = await supabase
        .from('watch_progress')
        .select('*')
        .eq('content_type', 'cinema')
        .eq('shikimori_id', kinopoiskId)
        .maybeSingle();
      const progress = data as WatchProgress | null;
      if (progress && (progress.season ?? 1) === season && progress.episode === episode) {
        const pos = progress.position_seconds;
        const dur = progress.duration_seconds;
        const nearEnd = dur ? pos / dur > 0.9 : false;
        if (pos >= 5 && !nearEnd) {
          resumeFrom = Math.floor(pos);
        }
      }
    }
  }

  const sources = await resolveCinemaEpisodeSources({
    kinopoiskId,
    season,
    episode,
    isSerial,
    translationId,
    resumeFrom,
  });

  return NextResponse.json({ ...sources, resumeFrom });
}

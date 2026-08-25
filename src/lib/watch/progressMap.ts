import { createClient } from '@/lib/supabase/server';
import type { ContentType } from '@/lib/types';

/**
 * Массово тянет текущую серию (watch_progress.episode) по списку
 * shikimori_id — один запрос на всю страницу каталога/карусели вместо N+1.
 * Используется карточками (AnimeCard/CinemaCard), чтобы показать «X из Y
 * серий» только у тайтлов, которые пользователь реально начал смотреть —
 * у остальных строки в watch_progress просто нет, currentEpisode не
 * передаётся, бейдж не рендерится (см. AnimeCard/CinemaCard).
 */
export async function getEpisodeProgressMap(
  contentType: ContentType,
  shikimoriIds: number[],
): Promise<Map<number, number>> {
  if (shikimoriIds.length === 0) return new Map();
  const supabase = createClient();
  const { data } = await supabase
    .from('watch_progress')
    .select('shikimori_id, episode')
    .eq('content_type', contentType)
    .in('shikimori_id', shikimoriIds);
  return new Map((data ?? []).map((r) => [r.shikimori_id as number, r.episode as number]));
}

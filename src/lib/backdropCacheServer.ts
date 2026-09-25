import { createClient } from '@/lib/supabase/server';
import { localBackdropUrl, type BackdropKind } from '@/lib/backdropPath';

/**
 * Чтение локального кэша hero-обложек — зеркало posterCacheServer.ts.
 * Отдельно от cacheBackdrops() намеренно: тот тянет sharp/fs, здесь только
 * лёгкий запрос к реестру.
 */

export { localBackdropUrl };
export type { BackdropKind };

/** Локальная ссылка на backdrop, если файл реально скачан — иначе null
 *  (вызывающий код фоллбэкает на прямую ссылку апстрима). Никогда не
 *  бросает: нет кэша — просто нет локальной ссылки. */
export async function getLocalBackdropUrl(
  kind: BackdropKind,
  id: number,
): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('backdrop_cache')
      .select('bytes')
      .eq('kind', kind)
      .eq('source_id', id)
      .gt('bytes', 0)
      .maybeSingle();
    if (error || !data) return null;
    return localBackdropUrl(kind, id);
  } catch {
    return null;
  }
}

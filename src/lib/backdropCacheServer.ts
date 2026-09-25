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

/** То же самое, но сразу для списка id — кому из них реально есть, что
 *  показать в hero (см. getHeroPick в lib/recommendations.ts: он случайно
 *  выбирает ОДИН из уже закэшированных при каждом рендере, а не только из
 *  единственного заранее выбранного кроном). */
export async function getLocalBackdropIds(
  kind: BackdropKind,
  ids: number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('backdrop_cache')
      .select('source_id')
      .eq('kind', kind)
      .in('source_id', ids)
      .gt('bytes', 0);
    if (error || !data) return new Set();
    return new Set(data.map((r) => (r as { source_id: number }).source_id));
  } catch {
    return new Set();
  }
}

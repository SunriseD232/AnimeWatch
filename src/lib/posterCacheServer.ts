import { createClient } from '@/lib/supabase/server';
import { localPosterUrl, type PosterKind } from '@/lib/posterPath';

/**
 * Чтение локального кэша постеров (см. миграцию 0029, lib/posterCache.ts).
 *
 * Отдельно от скачивателя намеренно: тот тянет sharp и fs/promises, и
 * затащить его в страницу значило бы тащить нативный модуль обработки
 * изображений в каждый рендер. Здесь только пути и один лёгкий запрос.
 *
 * НИКОГДА не бросает: нет кэша — просто нет локальных ссылок, страницы
 * продолжат отдавать ссылки на апстрим.
 */

export { localPosterUrl };
export type { PosterKind };

/** У кого из списка обложка уже лежит у нас. Один запрос на список. */
export async function getLocalPosterIds(
  kind: PosterKind,
  ids: number[],
): Promise<Set<number>> {
  const unique = [...new Set(ids)].filter((n) => Number.isFinite(n) && n > 0);
  if (unique.length === 0) return new Set();

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('poster_cache')
      .select('source_id')
      .eq('kind', kind)
      // bytes = 0 означает «скачать не вышло, файла нет» — такие ссылки
      // отдавать нельзя, иначе получим 404 вместо картинки.
      .gt('bytes', 0)
      .in('source_id', unique);

    if (error || !data) return new Set();
    return new Set(data.map((r) => (r as { source_id: number }).source_id));
  } catch {
    return new Set();
  }
}

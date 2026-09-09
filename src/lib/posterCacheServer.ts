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

/**
 * То же самое для смешанного списка (аниме и кино вперемешку — так выглядят
 * «Продолжить просмотр», «Вы хотели посмотреть», список и история в профиле).
 *
 * Возвращает готовые ссылки по ключу `${kind}:${id}`. Ключ, которого нет в
 * ответе, означает «файла нет» — и ссылку на него отдавать НЕЛЬЗЯ: карточка
 * получит 404, переживёт его и покажет запасную, но 404 останется в сетевой
 * панели у каждого такого тайтла. Именно это и было видно на главной.
 */
export async function getLocalPosterMap(
  items: { kind: PosterKind; id: number }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byKind = new Map<PosterKind, number[]>();

  for (const item of items) {
    if (!Number.isFinite(item.id) || item.id <= 0) continue;
    const list = byKind.get(item.kind);
    if (list) list.push(item.id);
    else byKind.set(item.kind, [item.id]);
  }

  await Promise.all(
    [...byKind].map(async ([kind, ids]) => {
      const found = await getLocalPosterIds(kind, ids);
      for (const id of found) out.set(`${kind}:${id}`, localPosterUrl(kind, id));
    }),
  );

  return out;
}

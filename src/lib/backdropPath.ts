/**
 * Путь к сохранённой hero-обложке — зеркало lib/posterPath.ts. Отдельный
 * модуль по той же причине: его тянут и клиентские компоненты (HeroBanner),
 * и серверные, а класть сюда запрос к базе означало бы протащить
 * supabase/server в клиентский бандл.
 */

export type BackdropKind = 'anime' | 'cinema';

/** Относительный, с нашего домена — см. localPosterUrl в posterPath.ts. */
export function localBackdropUrl(kind: BackdropKind, id: number): string {
  return `/backdrops/${kind}/${id}.webp`;
}

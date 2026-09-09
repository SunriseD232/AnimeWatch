/**
 * Путь к сохранённой обложке — и только он.
 *
 * Модуль намеренно пустой по зависимостям: его тянут и клиентские
 * компоненты, и серверные. Стоило положить сюда же запрос к базе — и сборка
 * упала: lib/shikimori.ts импортируется карточкой (client), а через него в
 * клиентский бандл поехал supabase/server с next/headers. Поэтому чтение
 * кэша живёт отдельно, в posterCacheServer.ts.
 */

export type PosterKind = 'anime' | 'cinema';

/** Относительный, с нашего же домена: так он одинаково работает и локально,
 *  и на проде, и не зависит от того, отдаёт файл nginx или роут приложения. */
export function localPosterUrl(kind: PosterKind, id: number): string {
  return `/posters/${kind}/${id}.webp`;
}

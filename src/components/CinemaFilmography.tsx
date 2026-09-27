'use client';

import { useMemo, useState } from 'react';
import CinemaCard from '@/components/CinemaCard';
import type { CinemaShort } from '@/lib/videoseed-catalog';

export interface CinemaFilmographyEntry {
  role: string;
  character: string | null;
  item: CinemaShort;
}

type Sort = 'year' | 'rating';

/**
 * Фильмография персоны TMDB — те же вкладки по роли/фильтр по типу/
 * сортировка, что у PersonFilmography.tsx (аниме/Shikimori), но карточки —
 * из НАШЕГО каталога (CinemaShort через getKpIdsByTmdbIds +
 * getCinemaIndexByIds, см. app/person/[source]/[id]/page.tsx): TMDB даёт
 * список ролей, а постер/рейтинг/ссылка — с сайта, как и везде на нём.
 */
export default function CinemaFilmography({ entries }: { entries: CinemaFilmographyEntry[] }) {
  const roles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.role, (counts.get(e.role) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.item.kind) set.add(e.item.kind);
    return [...set];
  }, [entries]);

  const [role, setRole] = useState<string>('all');
  const [kind, setKind] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('year');

  const filtered = useMemo(() => {
    let list = entries;
    if (role !== 'all') list = list.filter((e) => e.role === role);
    if (kind !== 'all') list = list.filter((e) => e.item.kind === kind);

    const sorted = [...list].sort((a, b) =>
      sort === 'year' ? (b.item.year ?? 0) - (a.item.year ?? 0) : (b.item.rating ?? 0) - (a.item.rating ?? 0),
    );

    // Один тайтл может встретиться в нескольких ролях одной персоны (напр.
    // и «Актёр», и «Режиссёр») — во вкладке «Все» это дало бы дубли карточек.
    const seen = new Set<number>();
    return sorted.filter((e) => {
      if (seen.has(e.item.id)) return false;
      seen.add(e.item.id);
      return true;
    });
  }, [entries, role, kind, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md bg-bg-card px-2 py-1.5 text-sm text-gray-200 ring-1 ring-inset ring-white/10"
        >
          <option value="all">Все роли ({entries.length})</option>
          {roles.map(([r, count]) => (
            <option key={r} value={r}>
              {r} ({count})
            </option>
          ))}
        </select>

        {kinds.length > 1 && (
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md bg-bg-card px-2 py-1.5 text-sm text-gray-200 ring-1 ring-inset ring-white/10"
          >
            <option value="all">Любой тип</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="rounded-md bg-bg-card px-2 py-1.5 text-sm text-gray-200 ring-1 ring-inset ring-white/10"
        >
          <option value="year">Сначала новые</option>
          <option value="rating">По рейтингу</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">Ничего не найдено по этому фильтру.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filtered.map((e) => (
            <CinemaCard key={`${e.item.id}-${e.role}`} item={e.item} />
          ))}
        </div>
      )}
    </div>
  );
}

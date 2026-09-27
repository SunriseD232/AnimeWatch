'use client';

import { useMemo, useState } from 'react';
import AnimeCard from '@/components/AnimeCard';
import type { ShikimoriPersonAnime, ShikimoriPersonWork } from '@/lib/shikimoriCredits';

type Work = ShikimoriPersonWork & { anime: ShikimoriPersonAnime };
type Sort = 'year' | 'score';

const KIND_LABELS: Record<string, string> = {
  tv: 'ТВ',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спешл',
  tv_special: 'ТВ-спешл',
  music: 'Клип',
};

/**
 * Фильмография персоны — вкладки по роли, фильтр по типу тайтла, сортировка
 * по году/рейтингу. Всё локально над уже загруженным списком (см.
 * getPersonAnimeWorks в lib/shikimoriCredits.ts) — фильмография персоны у
 * Shikimori отдаётся целиком одним запросом, повторно ходить в сеть на
 * каждый клик фильтра незачем.
 *
 * Фильтра по жанру здесь нет: /api/people/:id не отдаёт жанры тайтлов в
 * списке работ (это уже краткая карточка, не полная), а тянуть жанр
 * отдельным запросом на каждый из потенциально сотен тайтлов — то самое
 * N+1, которого исходный REST-клиент (см. animeIndex.ts) сознательно
 * избегает через GraphQL. Год и рейтинг для сортировки в этом же ответе
 * уже есть — используем их.
 */
export default function PersonFilmography({ works }: { works: Work[] }) {
  const roles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of works) counts.set(w.role, (counts.get(w.role) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [works]);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const w of works) if (w.anime.kind) set.add(w.anime.kind);
    return [...set];
  }, [works]);

  const [role, setRole] = useState<string>('all');
  const [kind, setKind] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('year');

  const filtered = useMemo(() => {
    let list = works;
    if (role !== 'all') list = list.filter((w) => w.role === role);
    if (kind !== 'all') list = list.filter((w) => w.anime.kind === kind);
    const withKey = list.map((w) => ({
      w,
      year: w.anime.aired_on ? Number(w.anime.aired_on.slice(0, 4)) : 0,
      score: Number(w.anime.score) || 0,
    }));
    withKey.sort((a, b) => (sort === 'year' ? b.year - a.year : b.score - a.score));
    // Один тайтл может встретиться в нескольких ролях одной персоны
    // (напр. и «Сценарий», и «Раскадровка» одним фильмом) — во вкладке
    // «Все» это дало бы дубли карточек одного и того же аниме подряд.
    const seen = new Set<number>();
    return withKey.filter(({ w }) => {
      if (seen.has(w.anime.id)) return false;
      seen.add(w.anime.id);
      return true;
    });
  }, [works, role, kind, sort]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md bg-bg-card px-2 py-1.5 text-sm text-gray-200 ring-1 ring-inset ring-white/10"
        >
          <option value="all">Все роли ({works.length})</option>
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
                {KIND_LABELS[k] ?? k}
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
          <option value="score">По рейтингу</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">Ничего не найдено по этому фильтру.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filtered.map(({ w }) => (
            <AnimeCard key={`${w.anime.id}-${w.role}`} anime={w.anime} />
          ))}
        </div>
      )}
    </div>
  );
}

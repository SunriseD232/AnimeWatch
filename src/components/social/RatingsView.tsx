'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import { fixPosterUrl } from '@/lib/format';
import type { TitleRating } from '@/lib/social/types';
import { StarIcon } from './icons';

/**
 * Список оценок: свой — во вкладке профиля, друга — на его странице.
 *
 * Сортировка переключается между «свежие» и «по оценке»: второй вариант и
 * есть то, ради чего смотрят оценки друга, — что ему понравилось больше всего.
 */

type Sort = 'recent' | 'score';

export default function RatingsView({
  ratings,
  localPosters = {},
  emptyText,
}: {
  ratings: TitleRating[];
  localPosters?: Record<string, string>;
  emptyText: React.ReactNode;
}) {
  const [sort, setSort] = useState<Sort>('score');

  const sorted = useMemo(() => {
    const copy = [...ratings];
    if (sort === 'score') {
      copy.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
    } else {
      copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return copy;
  }, [ratings, sort]);

  if (ratings.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-bg-card px-5 py-6 text-sm text-gray-300 ring-1 ring-white/5">
        <StarIcon className="h-5 w-5 text-accent-text" />
        <div>{emptyText}</div>
      </div>
    );
  }

  const average = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          Оценено: <span className="font-semibold text-gray-100">{ratings.length}</span> · средняя{' '}
          <span className="font-semibold tabular-nums text-gray-100">{average.toFixed(1)}</span>
        </p>
        <div role="group" aria-label="Сортировка" className="flex rounded-full bg-bg-card p-1 ring-1 ring-white/5">
          {(
            [
              ['score', 'По оценке'],
              ['recent', 'Свежие'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSort(value)}
              aria-pressed={sort === value}
              className={[
                'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                sort === value ? 'bg-accent text-accent-fg' : 'text-gray-300 hover:text-gray-100',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {sorted.map((r) => {
          const kind = r.contentType === 'cinema' ? 'cinema' : 'anime';
          return (
            <li key={`${kind}:${r.shikimoriId}`}>
              <Link
                href={`/${kind}/${r.shikimoriId}`}
                className="card-lift flex items-center gap-3 rounded-xl bg-bg-card p-2.5 ring-1 ring-white/5 hover:ring-accent/60"
              >
                <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
                  {r.posterUrl || localPosters[`${kind}:${r.shikimoriId}`] ? (
                    <PosterImage
                      sources={[localPosters[`${kind}:${r.shikimoriId}`], fixPosterUrl(r.posterUrl)]}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      placeholderClassName="h-full w-full"
                    />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 text-sm font-medium text-gray-100">
                    {r.title ?? 'Без названия'}
                  </span>
                  <span className="text-xs text-gray-400">{kind === 'cinema' ? 'Кино' : 'Аниме'}</span>
                </div>
                <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-base font-bold tabular-nums text-accent-fg">
                  <span className="sr-only">Оценка </span>
                  {r.score}
                  <span className="sr-only"> из 10</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

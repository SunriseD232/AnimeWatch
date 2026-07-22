'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SeasonInfo } from '@/lib/videoseed-catalog';
import TrailerButton from '@/components/TrailerButton';

interface Props {
  shikimoriId: number;
  seasons: SeasonInfo[];
  /** Сезон, на котором пользователь остановился (или null). */
  currentSeason: number | null;
  /** Серия внутри currentSeason (или null). */
  currentEpisode: number | null;
  /** Досмотренные серии из watched_episodes (точная подсветка). */
  watched?: { season: number; episode: number }[];
  /** Для кнопки «Трейлер сезона» — без него кнопка не показывается. */
  idImdb: string | null;
}

/**
 * Сетка серий с выбором сезона (для сериалов кино из Videoseed).
 * Серии до текущей подсвечены как просмотренные, текущая — акцентом.
 * Ссылки ведут на /cinema/watch/{id}/{season}/{episode}.
 */
export default function CinemaEpisodes({
  shikimoriId,
  seasons,
  currentSeason,
  currentEpisode,
  watched = [],
  idImdb,
}: Props) {
  const [selected, setSelected] = useState<number>(
    currentSeason ?? seasons[0]?.season ?? 1,
  );
  const active =
    seasons.find((s) => s.season === selected) ?? seasons[0] ?? null;
  if (!active) return null;

  const multiSeason = seasons.length > 1;
  const episodes = Array.from({ length: active.episodes }, (_, i) => i + 1);
  const watchedSet = new Set(watched.map((w) => `${w.season}:${w.episode}`));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {multiSeason ? (
          <div className="flex flex-wrap gap-2">
            {seasons.map((s) => (
              <button
                key={s.season}
                type="button"
                onClick={() => setSelected(s.season)}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition',
                  s.season === selected
                    ? 'bg-accent text-white ring-accent'
                    : 'bg-bg-card text-gray-300 ring-white/5 hover:bg-bg-soft hover:text-white',
                ].join(' ')}
              >
                Сезон {s.season}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        {idImdb && (
          // key=selected — сбрасывает состояние кнопки при смене сезона,
          // иначе показала бы трейлер предыдущего сезона до нового клика.
          <TrailerButton
            key={selected}
            fetchUrl={`/api/trailer?imdbId=${idImdb}&season=${selected}`}
            label={multiSeason ? `Трейлер сезона ${selected}` : 'Трейлер'}
          />
        )}
      </div>

      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
        {episodes.map((ep) => {
          // Просмотрено: точная пометка из watched_episodes, либо эвристика
          // (весь сезон раньше текущего / серия до текущей в нём).
          const isWatched =
            watchedSet.has(`${selected}:${ep}`) ||
            (currentSeason !== null &&
              (selected < currentSeason ||
                (selected === currentSeason &&
                  currentEpisode !== null &&
                  ep < currentEpisode)));
          const isCurrent =
            currentSeason === selected && currentEpisode === ep;
          return (
            <Link
              key={ep}
              href={`/cinema/watch/${shikimoriId}/${selected}/${ep}`}
              className={[
                'grid h-11 place-items-center rounded-lg text-sm font-medium ring-1 transition',
                isCurrent
                  ? 'bg-accent text-white ring-accent'
                  : isWatched
                    ? 'bg-accent/15 text-accent ring-accent/30'
                    : 'bg-bg-card text-gray-300 ring-white/5 hover:bg-bg-soft hover:text-white',
              ].join(' ')}
              aria-current={isCurrent ? 'true' : undefined}
            >
              {ep}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

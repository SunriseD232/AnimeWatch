'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SeasonInfo } from '@/lib/videoseed-catalog';
import TrailerButton from '@/components/TrailerButton';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';

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
  /** Для пометки «просмотрено» без захода в плеер — попадают в watched_episodes. */
  title: string;
  posterUrl: string | null;
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
  title,
  posterUrl,
}: Props) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<number>(
    currentSeason ?? seasons[0]?.season ?? 1,
  );
  const [watchedKeys, setWatchedKeys] = useState(
    new Set(watched.map((w) => `${w.season}:${w.episode}`)),
  );
  const [pending, setPending] = useState<string | null>(null);

  useEffect(
    () => setWatchedKeys(new Set(watched.map((w) => `${w.season}:${w.episode}`))),
    [watched],
  );

  async function markWatched(season: number, ep: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const key = `${season}:${ep}`;
    setPending(key);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Нет сессии');
      const { error } = await supabase.from('watched_episodes').upsert(
        {
          user_id: user.id,
          content_type: 'cinema',
          shikimori_id: shikimoriId,
          season,
          episode: ep,
          anime_title: title,
          poster_url: posterUrl,
        },
        { onConflict: 'user_id,content_type,shikimori_id,season,episode' },
      );
      if (error) throw error;
      setWatchedKeys((prev) => new Set(prev).add(key));
      toast(`Серия ${ep} отмечена просмотренной`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', 'error');
    } finally {
      setPending(null);
    }
  }

  const active =
    seasons.find((s) => s.season === selected) ?? seasons[0] ?? null;
  if (!active) return null;

  const multiSeason = seasons.length > 1;
  const episodes = Array.from({ length: active.episodes }, (_, i) => i + 1);

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
            watchedKeys.has(`${selected}:${ep}`) ||
            (currentSeason !== null &&
              (selected < currentSeason ||
                (selected === currentSeason &&
                  currentEpisode !== null &&
                  ep < currentEpisode)));
          const isCurrent =
            currentSeason === selected && currentEpisode === ep;
          return (
            <div key={ep} className="relative">
              <Link
                href={`/cinema/watch/${shikimoriId}/${selected}/${ep}`}
                className={[
                  'grid h-11 w-full place-items-center rounded-lg text-sm font-medium ring-1 transition',
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
              {!isWatched && (
                <button
                  type="button"
                  onClick={(e) => markWatched(selected, ep, e)}
                  disabled={pending === `${selected}:${ep}`}
                  aria-label={`Отметить серию ${ep} просмотренной`}
                  title="Отметить просмотренной"
                  className="press absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-bg-soft text-[10px] text-gray-400 ring-1 ring-white/10 transition hover:text-accent hover:ring-accent/60 disabled:opacity-40"
                >
                  ✓
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

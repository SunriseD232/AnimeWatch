'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';

interface Props {
  shikimoriId: number;
  total: number;
  currentEpisode: number | null;
  /** Досмотренные серии из watched_episodes (точная подсветка). */
  watchedEpisodes?: number[];
  /** База ссылки просмотра: /watch (аниме) или /cinema/watch (кино). */
  basePath?: string;
  /** Для пометки «просмотрено» без захода в плеер — попадают в watched_episodes. */
  title: string;
  posterUrl: string | null;
}

/**
 * Сетка кнопок серий. Досмотренные серии (и серии до текущей) подсвечены,
 * текущая — акцентом. У ещё не отмеченных серий — маленькая кнопка «✓» в
 * углу: пишет прямо в watched_episodes (см. ListButton — тот же паттерн
 * прямого клиентского supabase-запроса), не открывая плеер.
 */
export default function EpisodeGrid({
  shikimoriId,
  total,
  currentEpisode,
  watchedEpisodes = [],
  basePath = '/watch',
  title,
  posterUrl,
}: Props) {
  const { toast } = useToast();
  const [watchedSet, setWatchedSet] = useState(new Set(watchedEpisodes));
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => setWatchedSet(new Set(watchedEpisodes)), [watchedEpisodes]);

  async function markWatched(ep: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setPending(ep);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Нет сессии');
      const { error } = await supabase.from('watched_episodes').upsert(
        {
          user_id: user.id,
          content_type: 'anime',
          shikimori_id: shikimoriId,
          season: 1,
          episode: ep,
          anime_title: title,
          poster_url: posterUrl,
        },
        { onConflict: 'user_id,content_type,shikimori_id,season,episode' },
      );
      if (error) throw error;
      setWatchedSet((prev) => new Set(prev).add(ep));
      toast(`Серия ${ep} отмечена просмотренной`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', 'error');
    } finally {
      setPending(null);
    }
  }

  const episodes = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
      {episodes.map((ep) => {
        const isCurrent = currentEpisode === ep;
        const isWatched =
          watchedSet.has(ep) ||
          (currentEpisode !== null && ep < currentEpisode);
        return (
          <div key={ep} className="relative">
            <Link
              href={`${basePath}/${shikimoriId}/${ep}`}
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
                onClick={(e) => markWatched(ep, e)}
                disabled={pending === ep}
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
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import type { WatchProgress } from '@/lib/types';
import { formatTime, watchPercent } from '@/lib/format';

/** Карточка блока «Продолжить просмотр» с кнопкой убрать из списка. */
export default function ContinueCard({
  progress,
}: {
  progress: WatchProgress;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [hidden, setHidden] = useState(false);
  const [removing, setRemoving] = useState(false);

  const percent = watchPercent(
    progress.position_seconds,
    progress.duration_seconds,
  );

  // Кино маршрутизируется с сезоном, аниме — без.
  const watchHref =
    progress.content_type === 'cinema'
      ? `/cinema/watch/${progress.shikimori_id}/${progress.season ?? 1}/${progress.episode}`
      : `/watch/${progress.shikimori_id}/${progress.episode}`;

  async function remove() {
    if (removing) return;
    setRemoving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('watch_progress')
      .delete()
      .eq('content_type', progress.content_type)
      .eq('shikimori_id', progress.shikimori_id);
    if (error) {
      setRemoving(false);
      toast('Не удалось убрать из просмотра', 'error');
      return;
    }
    setHidden(true); // оптимистично прячем
    toast('Убрано из просмотра', 'success');
    router.refresh(); // обновляем серверный список
  }

  if (hidden) return null;

  return (
    <div className="group relative overflow-hidden rounded-xl bg-bg-card ring-1 ring-white/5 transition hover:ring-accent/60">
      <Link href={watchHref}>
        <div className="relative aspect-video w-full overflow-hidden bg-bg-soft">
          {progress.poster_url ? (
            // Постер бывает с Shikimori (аниме) или Kodik/Кинопоиска (кино) —
            // обычный <img>, чтобы не заводить allowlist доменов next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={progress.poster_url}
              alt={progress.anime_title}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-600">
              нет постера
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
            Серия {progress.episode} · {formatTime(progress.position_seconds)}
          </span>
          {percent !== null && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div
                className="h-full bg-accent"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
        <div className="p-2.5">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-gray-100">
            {progress.anime_title}
          </h3>
        </div>
      </Link>

      {/* Крестик: убрать из «Продолжить просмотр» */}
      <button
        type="button"
        onClick={remove}
        disabled={removing}
        aria-label="Убрать из просмотра"
        title="Убрать из просмотра"
        className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-sm text-white opacity-0 transition hover:bg-red-600 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  );
}

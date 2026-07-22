'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import ExpandTitleButton from '@/components/ExpandTitleButton';
import type { WatchProgress } from '@/lib/types';
import { fixPosterUrl, formatTime, watchPercent } from '@/lib/format';

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
  // Двухшаговое удаление: первый клик по ✕ показывает подтверждение.
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Авто-сброс подтверждения, если пользователь передумал и ничего не нажал.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

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
    <div className="card-lift group relative overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 hover:ring-accent/60">
      <Link href={watchHref}>
        <div className="relative aspect-video w-full overflow-hidden bg-bg-soft">
          {progress.poster_url ? (
            // Постер бывает с Shikimori (аниме) или Kodik/Кинопоиска (кино) —
            // обычный <img>, чтобы не заводить allowlist доменов next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fixPosterUrl(progress.poster_url)!}
              alt={progress.anime_title}
              loading="lazy"
              referrerPolicy="no-referrer"
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
          <h3
            ref={titleRef}
            className={[
              'text-sm font-medium leading-snug text-gray-100',
              expanded ? '' : 'line-clamp-2',
            ].join(' ')}
          >
            {progress.anime_title}
          </h3>
        </div>
      </Link>

      <ExpandTitleButton
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        titleRef={titleRef}
      />

      {/* Убрать из «Продолжить просмотр» — с подтверждением. Кнопка всегда
          видима (не по hover): на тач-устройствах hover не срабатывает. */}
      {confirming ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-black/85 p-1">
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {removing ? 'Убираем…' : 'Убрать'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md px-2 py-1 text-xs text-gray-300 hover:text-white"
          >
            Отмена
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Убрать из просмотра"
          title="Убрать из просмотра"
          className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-sm text-white transition hover:bg-red-600"
        >
          ✕
        </button>
      )}
    </div>
  );
}

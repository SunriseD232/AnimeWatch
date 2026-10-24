'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';

export type EpisodeMarkState =
  | { status: 'done' }
  | { status: 'in_progress'; percent: number | null }
  | { status: 'planned' }
  | { status: 'none' };

/**
 * Метка выпуска в списке: тег «Прослушан» / «В процессе · 34 %» / «В
 * планах» и меню, где её можно поставить или снять руками (24.10.2026).
 *
 * Откуда берётся (миграция 0065):
 *   • «Прослушан» — watched_episodes (его же ставит плеер на 90 %);
 *   • «В процессе» — episode_marks со status = in_progress: плеер пишет туда
 *     место каждого начатого выпуска;
 *   • «В планах» — episode_marks со status = planned, только руками.
 * Пишет клиент пользователя: на обеих таблицах RLS «только свои строки».
 */
export default function EpisodeMark({
  podcastId,
  podcastTitle,
  artworkUrl,
  episode,
  initial,
  isAuthed,
}: {
  podcastId: number;
  podcastTitle: string;
  artworkUrl: string | null;
  episode: number;
  initial: EpisodeMarkState;
  isAuthed: boolean;
}) {
  const { toast } = useToast();
  const [mark, setMark] = useState<EpisodeMarkState>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function apply(next: 'done' | 'planned' | 'none') {
    setOpen(false);
    setBusy(true);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('нет входа');
      const markKey = { user_id: user.id, content_type: 'podcast', shikimori_id: podcastId, episode };
      const clearMark = () =>
        supabase
          .from('episode_marks')
          .delete()
          .eq('user_id', user.id)
          .eq('content_type', 'podcast')
          .eq('shikimori_id', podcastId)
          .eq('episode', episode);
      const clearDone = () =>
        supabase
          .from('watched_episodes')
          .delete()
          .eq('user_id', user.id)
          .eq('content_type', 'podcast')
          .eq('shikimori_id', podcastId)
          .eq('episode', episode);

      if (next === 'done') {
        await clearMark();
        const { error } = await supabase.from('watched_episodes').upsert(
          {
            user_id: user.id,
            content_type: 'podcast',
            shikimori_id: podcastId,
            season: 1,
            episode,
            anime_title: podcastTitle,
            poster_url: artworkUrl,
          },
          { onConflict: 'user_id,content_type,shikimori_id,season,episode' },
        );
        if (error) throw error;
        setMark({ status: 'done' });
      } else if (next === 'planned') {
        await clearDone();
        const { error } = await supabase.from('episode_marks').upsert(
          { ...markKey, status: 'planned', position_seconds: null, duration_seconds: null, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,content_type,shikimori_id,episode' },
        );
        if (error) throw error;
        setMark({ status: 'planned' });
      } else {
        await Promise.all([clearMark(), clearDone()]);
        setMark({ status: 'none' });
      }
    } catch {
      toast('Не удалось изменить отметку. Попробуйте ещё раз.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const tag =
    mark.status === 'done'
      ? { text: 'Прослушан', className: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' }
      : mark.status === 'in_progress'
        ? {
            text: mark.percent != null ? `В процессе · ${mark.percent} %` : 'В процессе',
            className: 'bg-accent/15 text-accent-text ring-accent/30',
          }
        : mark.status === 'planned'
          ? { text: 'В планах', className: 'bg-amber-500/15 text-amber-200 ring-amber-400/30' }
          : null;

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center gap-1">
      {tag ? (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tag.className}`}>
          {tag.text}
        </span>
      ) : null}
      {isAuthed ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={busy}
          aria-label="Отметить выпуск"
          title="Отметить выпуск"
          className="press grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      ) : null}
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 flex w-48 flex-col overflow-hidden rounded-xl bg-bg-card py-1 text-sm shadow-2xl ring-1 ring-white/10"
        >
          {mark.status !== 'done' ? (
            <MenuItem onClick={() => void apply('done')}>Отметить прослушанным</MenuItem>
          ) : null}
          {mark.status !== 'planned' ? <MenuItem onClick={() => void apply('planned')}>В планы</MenuItem> : null}
          {mark.status !== 'none' ? <MenuItem onClick={() => void apply('none')}>Снять отметку</MenuItem> : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="px-3 py-2 text-left text-gray-200 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

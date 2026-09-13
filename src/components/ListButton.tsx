'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import {
  BellIcon,
  BellOffIcon,
  CheckIcon,
  ChevronDownIcon,
  ListPlusIcon,
} from '@/components/social/icons';
import { logEvent } from '@/lib/clientLog';
import { LIST_STATUS_OPTIONS } from '@/lib/listStatus';
import type { ContentType, UserListStatus } from '@/lib/types';

interface Props {
  shikimoriId: number;
  contentType?: ContentType;
  animeTitle: string;
  posterUrl: string | null;
  initialStatus: UserListStatus | null;
  initialMuted?: boolean;
  isAuthed: boolean;
}

const PANEL_WIDTH = 240;
const EDGE_GAP = 12;

/**
 * Кнопка «В список» на странице тайтла.
 *
 * Сделана той же формы, что «Оценить» рядом (components/social/TitleRating):
 * значок слева, подпись, шеврон-иконка справа, панель со скруглением и
 * отступами. Раньше у неё были свой символ «▾» вместо иконки, свой «+» в
 * тексте и плоский список без отступов — в одном ряду две кнопки выглядели
 * взятыми из разных сайтов.
 */
export default function ListButton({
  shikimoriId,
  contentType = 'anime',
  animeTitle,
  posterUrl,
  initialStatus,
  initialMuted = false,
  isAuthed,
}: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<UserListStatus | null>(initialStatus);
  const [muted, setMuted] = useState(initialMuted);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelLeft, setPanelLeft] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const current = LIST_STATUS_OPTIONS.find((o) => o.value === status);

  // Закрытие по клику вовне и по Escape; фокус — внутрь панели на текущий
  // статус, по Escape — обратно на кнопку (тот же порядок, что у оценки).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      // Модель меню: стрелки ходят по пунктам по кругу (WAI-ARIA menu).
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
        if (items.length === 0) return;
        e.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    const target =
      panelRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      panelRef.current?.querySelector<HTMLButtonElement>('button');
    target?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE_GAP);
      const left = Math.max(EDGE_GAP, Math.min(rect.left, window.innerWidth - EDGE_GAP - width));
      setPanelLeft(left - rect.left);
    }
    setOpen((v) => !v);
  }

  async function choose(next: UserListStatus | null) {
    setOpen(false);
    triggerRef.current?.focus();
    if (!isAuthed) {
      toast('Войдите, чтобы вести список', 'info');
      return;
    }
    if (next === status) return;
    setSaving(true);
    const supabase = createClient();
    try {
      if (next === null) {
        const { error } = await supabase
          .from('user_list')
          .delete()
          .eq('content_type', contentType)
          .eq('shikimori_id', shikimoriId);
        if (error) throw error;
        setStatus(null);
        setMuted(false);
        toast('Убрано из списка', 'success');
        logEvent('list.removed', { contentType, shikimoriId });
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Сессия закончилась. Войдите заново.');
        const { error } = await supabase.from('user_list').upsert(
          {
            user_id: user.id,
            content_type: contentType,
            shikimori_id: shikimoriId,
            anime_title: animeTitle,
            poster_url: posterUrl,
            status: next,
          },
          { onConflict: 'user_id,content_type,shikimori_id' },
        );
        if (error) throw error;
        setStatus(next);
        toast('Список обновлён', 'success');
        logEvent('list.status_changed', { contentType, shikimoriId, from: status, to: next });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось обновить список. Попробуйте ещё раз.';
      logEvent('list.change_failed', { contentType, shikimoriId, to: next, message: msg });
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleMute() {
    setOpen(false);
    triggerRef.current?.focus();
    const next = !muted;
    setSaving(true);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('user_list')
        .update({ muted: next })
        .eq('content_type', contentType)
        .eq('shikimori_id', shikimoriId);
      if (error) throw error;
      setMuted(next);
      toast(next ? 'Уведомления по тайтлу выключены' : 'Уведомления включены', 'success');
      logEvent('list.mute_changed', { contentType, shikimoriId, muted: next });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось. Попробуйте ещё раз.';
      logEvent('list.mute_change_failed', { contentType, shikimoriId, message: msg });
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/5 focus-visible:bg-white/5';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={saving}
        className={[
          'press flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition',
          current
            ? 'border-accent/60 bg-accent/10 text-gray-100 hover:bg-accent/15'
            : 'border-white/10 bg-bg-card text-gray-100 hover:bg-bg-soft',
        ].join(' ')}
      >
        {current ? (
          <CheckIcon className="h-4 w-4 text-accent-text" />
        ) : (
          <ListPlusIcon className="h-4 w-4" />
        )}
        <span>{current ? current.label : 'В список'}</span>
        <ChevronDownIcon className="h-4 w-4 opacity-60" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Статус в списке"
          style={{ left: panelLeft }}
          className="glass-panel absolute z-20 mt-2 w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 p-1.5 shadow-2xl"
        >
          {LIST_STATUS_OPTIONS.map((o) => {
            const selected = status === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(o.value)}
                className={[itemClass, selected ? 'font-semibold text-gray-100' : 'text-gray-200'].join(' ')}
              >
                <span className="grid h-4 w-4 place-items-center">
                  {selected && <CheckIcon className="h-4 w-4 text-accent-text" />}
                </span>
                {o.label}
              </button>
            );
          })}
          {status && (
            <div className="mt-1 border-t border-white/10 pt-1">
              <button type="button" role="menuitem" onClick={toggleMute} className={`${itemClass} text-gray-200`}>
                {muted ? <BellIcon className="h-4 w-4" /> : <BellOffIcon className="h-4 w-4" />}
                {muted ? 'Включить уведомления' : 'Не уведомлять о сериях'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(null)}
                className={`${itemClass} text-red-300 hover:bg-red-500/10 focus-visible:bg-red-500/10`}
              >
                <span className="h-4 w-4" aria-hidden="true" />
                Убрать из списка
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

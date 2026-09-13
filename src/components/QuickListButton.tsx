'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import { useDismissOnOutside } from '@/components/useAnchoredPanel';
import { CheckIcon, PlusIcon } from '@/components/social/icons';
import { logEvent } from '@/lib/clientLog';
import { LIST_STATUS_OPTIONS } from '@/lib/listStatus';
import type { ContentType, UserListStatus } from '@/lib/types';

interface Props {
  shikimoriId: number;
  contentType: ContentType;
  title: string;
  posterUrl: string | null;
}

/**
 * Компактная кнопка «+» на карточке каталога/главной — добавить тайтл в
 * список, не заходя внутрь. По клику раскрывается меню статусов (тот же
 * набор, что у большой «В список» на странице тайтла).
 *
 * Меню — порталом в <body>, а не внутри карточки: у карточки
 * overflow-hidden и rounded-2xl, любое выпадающее меню внутри неё
 * обрезалось бы её краем. Позицию считаем от кнопки (useAnchoredPanel).
 *
 * Начальный статус карточка не знает (в каталоге его не тянем, чтобы не
 * гонять лишний запрос на каждую из 24 карточек) — поэтому значок «+» до
 * первого действия, а после выбора показываем галочку. Повторный выбор
 * просто перезапишет статус (upsert), это безопасно.
 */
export default function QuickListButton({ shikimoriId, contentType, title, posterUrl }: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<UserListStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Позицию меню считаем от самой кнопки (не от шапки, как дропдауны
  // навигации): кнопка стоит в углу карточки где угодно по странице, и меню
  // должно вставать рядом с ней. Ширину меню держим фиксированной, чтобы
  // прижать к правому/левому краю без переполнения.
  const MENU_W = 208;
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    // Меню обычно 5 пунктов ~ 240px. Хватает ли места снизу — иначе вверх.
    const estH = 248;
    const below = r.bottom + gap;
    const top = below + estH > window.innerHeight && r.top - gap - estH > 8 ? r.top - gap - estH : below;
    // Выравниваем по правому краю кнопки, но не вылезаем за поля экрана.
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - 8 - MENU_W));
    setBox({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [open, measure]);

  useDismissOnOutside(open, () => setOpen(false), anchorRef, panelRef);

  async function choose(next: UserListStatus) {
    setOpen(false);
    if (next === status) return;
    setSaving(true);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Войдите, чтобы вести список');
      const { error } = await supabase.from('user_list').upsert(
        {
          user_id: user.id,
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: title,
          poster_url: posterUrl,
          status: next,
        },
        { onConflict: 'user_id,content_type,shikimori_id' },
      );
      if (error) throw error;
      setStatus(next);
      toast('Добавлено в список', 'success');
      logEvent('list.status_changed', { contentType, shikimoriId, from: status, to: next, source: 'card' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось. Попробуйте ещё раз.';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!open) measure();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={saving}
        aria-label={status ? 'Изменить статус в списке' : 'Добавить в список'}
        title={status ? 'В списке' : 'Добавить в список'}
        // Тот же кружок, что у «i» рядом и у кнопок в уведомлениях.
        className={[
          'press z-10 grid h-7 w-7 place-items-center rounded-full backdrop-blur transition',
          "before:absolute before:inset-[-8px] before:content-['']",
          status
            ? 'bg-accent/90 text-accent-fg hover:bg-accent'
            : 'bg-bg-card/80 text-gray-300 hover:bg-white/10 hover:text-white',
        ].join(' ')}
      >
        {status ? <CheckIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Добавить в список"
            style={{ top: box.top, left: box.left, width: MENU_W }}
            className="glass-panel fixed z-50 max-w-[calc(100vw-1rem)] rounded-2xl border border-white/10 p-1.5 shadow-2xl"
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
                  className={[
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/5 focus-visible:bg-white/5',
                    selected ? 'font-semibold text-gray-100' : 'text-gray-200',
                  ].join(' ')}
                >
                  <span className="grid h-4 w-4 place-items-center">
                    {selected && <CheckIcon className="h-4 w-4 text-accent-text" />}
                  </span>
                  {o.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

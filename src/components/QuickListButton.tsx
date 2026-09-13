'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '@/components/useAnchoredPanel';
import { useQuickListStatus } from '@/components/useQuickListStatus';
import { CheckIcon, PlusIcon, XIcon } from '@/components/social/icons';
import { LIST_STATUS_OPTIONS } from '@/lib/listStatus';
import type { ContentType } from '@/lib/types';

interface Props {
  shikimoriId: number;
  contentType: ContentType;
  title: string;
  posterUrl: string | null;
}

const MENU_W = 176;

/**
 * Компактная кнопка «+» на карточке каталога/главной — добавить тайтл в
 * список, не заходя внутрь. По клику раскрывается меню статусов (тот же
 * набор, что у большой «В список» на странице тайтла), «выезжая» справа от
 * кнопки — карточка внизу длинной ленты, и меню, просто возникающее на
 * месте, терялось среди соседних постеров.
 *
 * Меню — порталом в <body>, а не внутри карточки: у карточки
 * overflow-hidden и rounded-2xl, любое выпадающее меню внутри неё
 * обрезалось бы её краем. Позицию считаем от самой кнопки, не от шапки.
 *
 * Закрывается тремя путями: клик по варианту (и сохраняет), клик по кресту
 * в шапке меню, клик вовне (useDismissOnOutside) — держит крест явным, а не
 * полагается только на «клик мимо», раз пользователь попросил его отдельно.
 */
export default function QuickListButton({ shikimoriId, contentType, title, posterUrl }: Props) {
  const { status, saving, choose } = useQuickListStatus({ shikimoriId, contentType, title, posterUrl, source: 'card' });
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    // Меню обычно 5 пунктов + шапка ~ 220px. Хватает ли места снизу — иначе вверх.
    const estH = 224;
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

  async function pick(next: (typeof LIST_STATUS_OPTIONS)[number]['value']) {
    setOpen(false);
    await choose(next);
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
            style={{ top: box.top, left: box.left, width: MENU_W }}
            className="glass-panel animate-quick-add fixed z-50 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
          >
            {/* Шапка с крестом стоит СНАРУЖИ role="menu": у меню как ARIA-
                роли допустимые прямые потомки — только пункты (menuitem*),
                посторонний div внутри — нарушение (aria-required-children,
                поймано axe). role и aria-label поэтому на списке пунктов
                ниже, а не на всей панели. */}
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">В список</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Закрыть"
                className="press grid h-6 w-6 place-items-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div role="menu" aria-label="Добавить в список">
              {LIST_STATUS_OPTIONS.map((o) => {
                const selected = status === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => void pick(o.value)}
                    className={[
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-white/5 focus-visible:bg-white/5',
                      selected ? 'font-semibold text-gray-100' : 'text-gray-300',
                    ].join(' ')}
                  >
                    <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
                      {selected && <CheckIcon className="h-3.5 w-3.5 text-accent-text" />}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

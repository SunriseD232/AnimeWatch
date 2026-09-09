'use client';

import { useEffect, useRef, useState } from 'react';
import type { FilterOptionDef } from '@/lib/catalogFilters';

/**
 * Выбор сортировки каталога.
 *
 * Свой дропдаун, а не нативный `<select>`, по двум причинам. Во-первых,
 * иконку текущей сортировки приходилось держать СНАРУЖИ поля — разметку
 * внутри `<option>` браузеры не рисуют, — и кликабельной она не была: по
 * значку ничего не происходило, хотя выглядел он частью контрола. Во-вторых,
 * нативный список открывается системным меню, которое не подчиняется теме
 * сайта и появляется рывком.
 *
 * Здесь весь контрол — одна кнопка: и значок, и подпись, и стрелка. Список
 * открывается тем же полупрозрачным стеклом, что шапка и уведомления, с
 * короткой анимацией.
 */
export default function SortDropdown({
  value,
  options,
  icons,
  onChange,
}: {
  value: string;
  options: readonly FilterOptionDef[];
  /** Значок для каждой сортировки по её значению. */
  icons: Record<string, React.ReactNode>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={rootRef} className="relative">
      <span className="sr-only" id="sort-label">
        Сортировка
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="sort-label"
        className="press flex items-center gap-2 rounded-full bg-bg-soft px-3 py-1.5 text-sm text-gray-100 transition hover:bg-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400">
          {icons[value]}
        </svg>
        {current?.label}
        {/* Шеврон поворачивается на раскрытие — тот же приём, что у кнопки
            «Фильтры»: состояние контрола видно, не читая список. */}
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 fill-none stroke-current stroke-2 text-gray-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        >
          <path d="M5.5 8l4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-labelledby="sort-label"
          className="glass animate-filters-panel absolute left-0 z-30 mt-2 min-w-full overflow-hidden whitespace-nowrap rounded-2xl border border-white/10 shadow-2xl"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!active) onChange(o.value);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                    active ? 'bg-accent/15 text-accent' : 'text-gray-200 hover:bg-white/5'
                  }`}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0">
                    {icons[o.value]}
                  </svg>
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

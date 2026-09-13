'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from '@/components/social/icons';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Выпадающий список фильтра статуса — мобильная замена ряду из шести
 * кнопок (см. UserListView): та же строка на телефоне растягивалась на
 * два-три ряда над списком, которого пришли смотреть. Тот же визуальный
 * язык, что у SortDropdown каталога: одна кнопка-триггер, панель тем же
 * стеклом, без лишнего внешнего отступа — сама панель обрезает углы у
 * первого/последнего пункта (overflow-hidden), а не оборачивает каждый
 * пункт в свою скруглённую рамку.
 */
export default function StatusFilterDropdown({
  value,
  options,
  counts,
  onChange,
  label,
}: {
  value: string;
  options: readonly FilterOption[];
  /** Число тайтлов на каждое значение — показывается справа от подписи. */
  counts: Record<string, number>;
  onChange: (value: string) => void;
  label: string;
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
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <span className="sr-only" id="status-filter-label">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="status-filter-label"
        className="press flex w-full items-center justify-between gap-2 rounded-lg bg-bg-card px-3 py-1.5 text-left text-sm font-medium text-gray-100 ring-1 ring-white/5 transition hover:bg-bg-soft"
      >
        <span className="truncate">
          {current.label}
          <span className="ml-1.5 text-xs opacity-70">{counts[current.value] ?? 0}</span>
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-labelledby="status-filter-label"
          className="glass-panel animate-filters-panel absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (!selected) onChange(o.value);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                    selected ? 'bg-accent/15 text-accent-text' : 'text-gray-200 hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
                      {selected && <CheckIcon className="h-3.5 w-3.5" />}
                    </span>
                    {o.label}
                  </span>
                  <span className="text-xs opacity-70">{counts[o.value] ?? 0}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

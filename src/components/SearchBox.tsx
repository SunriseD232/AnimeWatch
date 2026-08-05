'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { SearchSuggestion } from '@/app/api/search/suggest/route';

/**
 * Поисковый инпут с debounce 400 мс. Меняет URL /search?q=...
 * Режим (аниме/кино) определяется по текущему разделу: под /cinema ищем кино.
 * Плюс подсказки при вводе (debounce 250 мс) — короткий дропдаун с прямыми
 * ссылками на тайтлы, не дожидаясь перехода на /search.
 */
export default function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLFormElement>(null);

  // На страницах кино и в результатах поиска кино держим кино-режим.
  const isCinema =
    pathname.startsWith('/cinema') || params.get('type') === 'cinema';

  const buildHref = (q: string) => {
    const query = new URLSearchParams({ q });
    if (isCinema) query.set('type', 'cinema');
    return `/search?${query.toString()}`;
  };

  useEffect(() => {
    const trimmed = value.trim();
    const handle = setTimeout(() => {
      if (trimmed.length === 0) return;
      router.push(buildHref(trimmed));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setActiveIndex(-1);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/suggest?q=${encodeURIComponent(trimmed)}&type=${isCinema ? 'cinema' : 'anime'}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { items: SearchSuggestion[] };
        setSuggestions(data.items);
        setActiveIndex(-1);
      } catch {
        // Отменённый или сетевой сбой — просто без подсказок.
      }
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [value, isCinema]);

  // Закрытие дропдауна по клику вовне — тот же паттерн, что и в других
  // раскрывающихся меню сайта (см. NotificationBell/ListButton).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const showDropdown = open && value.trim().length >= 2 && suggestions.length > 0;

  return (
    <form
      ref={rootRef}
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) {
          setOpen(false);
          router.push(buildHref(trimmed));
        }
      }}
      className="relative"
      role="search"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
      >
        <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M13 13L17.5 17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {/* text-base (16px) обязателен: при меньшем шрифте iOS/Android
          автоматически зумят страницу при фокусе на инпуте. */}
      <input
        type="search"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showDropdown) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, -1));
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            const s = suggestions[activeIndex];
            setOpen(false);
            router.push(
              `/${s.contentType === 'cinema' ? 'cinema' : 'anime'}/${s.id}`,
            );
          }
        }}
        placeholder={isCinema ? 'Поиск фильмов и сериалов…' : 'Поиск аниме…'}
        aria-label={isCinema ? 'Поиск фильмов и сериалов' : 'Поиск аниме'}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        className="w-full rounded-full border border-white/10 bg-bg-card py-2 pl-10 pr-4 text-base text-gray-100 placeholder:text-gray-400 transition focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
      />

      {showDropdown && (
        <ul
          id="search-suggestions"
          role="listbox"
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-bg-card shadow-2xl"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.contentType}:${s.id}`} role="option" aria-selected={i === activeIndex}>
              <Link
                href={`/${s.contentType === 'cinema' ? 'cinema' : 'anime'}/${s.id}`}
                onClick={() => setOpen(false)}
                className={[
                  'flex items-center gap-3 px-3 py-2 text-sm transition',
                  i === activeIndex ? 'bg-white/10' : 'hover:bg-white/5',
                ].join(' ')}
              >
                <div className="h-10 w-7 shrink-0 overflow-hidden rounded bg-bg-soft">
                  {s.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.poster}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <span className="min-w-0 flex-1 truncate text-gray-100">
                  {s.title}
                </span>
                {s.year && (
                  <span className="shrink-0 text-xs text-gray-500">
                    {s.year}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

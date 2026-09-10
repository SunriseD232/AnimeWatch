'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside } from '@/components/useAnchoredPanel';
import type { SearchSuggestion } from '@/app/api/search/suggest/route';
import { logEvent } from '@/lib/clientLog';

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
  const panelRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);

  // На страницах кино и в результатах поиска кино держим кино-режим.
  const isCinema =
    pathname.startsWith('/cinema') || params.get('type') === 'cinema';

  const buildHref = (q: string) => {
    const query = new URLSearchParams({ q });
    if (isCinema) query.set('type', 'cinema');
    return `/search?${query.toString()}`;
  };

  // Раньше здесь был второй debounce, который каждые 400 мс уводил на
  // /search прямо во время набора. Из-за него страница дёргалась на каждой
  // букве, а выпадающий список подсказок было не разглядеть: он появлялся
  // одновременно с переходом на отдельную страницу и тут же исчезал вместе с
  // ней. Теперь набор только показывает подсказки; на полную страницу
  // результатов уводит Enter или пункт «Показать все результаты».
  //
  // Исключение — сама /search: там строка поиска и есть страница, и
  // продолжать печатать, не видя, как меняется выдача, странно.
  const onSearchPage = pathname === '/search';

  useEffect(() => {
    if (!onSearchPage) return;
    const trimmed = value.trim();
    const handle = setTimeout(() => {
      if (trimmed.length === 0) return;
      router.push(buildHref(trimmed));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, onSearchPage]);

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

  // Закрытие по клику вовне — общий хук (см. useDismissOnOutside).
  // panelRef обязателен: список подсказок живёт в <body>, и без него клик по
  // подсказке считался бы внешним — список закрывался бы по mousedown, а сам
  // переход не происходил.
  useDismissOnOutside(open, () => setOpen(false), rootRef, panelRef);

  const showDropdown = open && value.trim().length >= 2 && suggestions.length > 0;

  // Геометрия поля: список выносится порталом в body и позиционируется по
  // ней. Иначе он лежал бы внутри шапки, а у элемента с backdrop-filter
  // потомки размывают ЕГО, а не страницу под ним — размытия не было видно
  // вовсе. Тот же элемент становится containing block для fixed, так что
  // координаты тоже считались бы от шапки.
  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // -1px: список прирастает к полю без шва, перекрывая его нижнюю границу.
    setBox({ top: r.bottom - 1, left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [showDropdown, measure]);

  return (
    <form
      ref={rootRef}
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) {
          setOpen(false);
          logEvent('search.submit', { q: trimmed, type: isCinema ? 'cinema' : 'anime' });
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
            logEvent('search.suggestion_click', {
              id: s.id,
              contentType: s.contentType,
              title: s.title,
              via: 'keyboard',
            });
            router.push(
              `/${s.contentType === 'cinema' ? 'cinema' : 'anime'}/${s.id}`,
            );
          }
        }}
        // Одно слово: раздел и так виден по переключателю над выдачей, а на
        // телефоне «Поиск фильмов и сериалов…» не помещался в поле и
        // обрезался многоточием посреди слова. Полная формулировка осталась
        // в aria-label — для экранного диктора контекст важнее краткости.
        placeholder="Поиск"
        aria-label={isCinema ? 'Поиск фильмов и сериалов' : 'Поиск аниме'}
        ref={inputRef}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        // Пока список открыт, поле теряет нижние скругления и подсказки
        // прирастают к нему снизу — вместе получается одна раскрытая панель,
        // а не поле и отдельная карточка под ним. Кольцо фокуса в этот
        // момент тоже убираем: оно обводило бы только верхнюю половину.
        className={[
          'w-full border border-white/10 bg-bg-card py-2 pl-10 pr-4 text-base text-gray-100 placeholder:text-gray-400 transition focus:border-accent/60 focus:outline-none',
          showDropdown
            ? 'rounded-t-2xl rounded-b-none border-b-white/10'
            : 'rounded-full focus:ring-2 focus:ring-accent/40',
        ].join(' ')}
      />

      {showDropdown &&
        box &&
        createPortal(
          <ul
            ref={panelRef}
            id="search-suggestions"
            role="listbox"
            // Прирастает к полю без зазора и с прямым верхом: список —
            // продолжение поля, а не отдельная карточка рядом с ним. У самого
            // поля в этот момент скругляется только верх.
            style={{ top: box.top, left: box.left, width: box.width }}
            className="glass-panel fixed z-50 overflow-hidden rounded-b-2xl border border-t-0 border-white/10 shadow-2xl"
          >
          {suggestions.map((s, i) => (
            <li key={`${s.contentType}:${s.id}`} role="option" aria-selected={i === activeIndex}>
              <Link
                href={`/${s.contentType === 'cinema' ? 'cinema' : 'anime'}/${s.id}`}
                onClick={() => {
                  setOpen(false);
                  logEvent('search.suggestion_click', {
                    id: s.id,
                    contentType: s.contentType,
                    title: s.title,
                    via: 'click',
                  });
                }}
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

          {/* Выход на полную выдачу — последним пунктом списка. Раньше туда
              уводило само печатание, теперь это осознанное действие: либо
              Enter, либо эта строка. */}
          <li>
            <Link
              href={buildHref(value.trim())}
              onClick={() => {
                setOpen(false);
                logEvent('search.submit', {
                  q: value.trim(),
                  type: isCinema ? 'cinema' : 'anime',
                  via: 'dropdown',
                });
              }}
              className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2.5 text-sm font-medium text-accent transition hover:bg-white/5"
            >
              Показать все результаты
              <span aria-hidden="true">→</span>
            </Link>
          </li>
          </ul>,
          document.body,
        )}
    </form>
  );
}

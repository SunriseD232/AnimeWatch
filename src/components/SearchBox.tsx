'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Поисковый инпут с debounce 400 мс. Меняет URL /search?q=...
 * Режим (аниме/кино) определяется по текущему разделу: под /cinema ищем кино.
 */
export default function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [value, setValue] = useState(params.get('q') ?? '');

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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) router.push(buildHref(trimmed));
      }}
      className="relative"
      role="search"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
      >
        <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M13 13L17.5 17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {/* text-base (16px) обязателен: при меньшем шрифте iOS/Android
          автоматически зумят страницу при фокусе на инпуте. */}
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={isCinema ? 'Поиск фильмов и сериалов…' : 'Поиск аниме…'}
        aria-label={isCinema ? 'Поиск фильмов и сериалов' : 'Поиск аниме'}
        className="w-full rounded-full border border-white/10 bg-bg-card py-2 pl-10 pr-4 text-base text-gray-100 placeholder:text-gray-500 transition focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
    </form>
  );
}

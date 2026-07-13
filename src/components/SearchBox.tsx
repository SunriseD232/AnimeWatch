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
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={isCinema ? 'Поиск фильмов и сериалов…' : 'Поиск аниме…'}
        aria-label={isCinema ? 'Поиск фильмов и сериалов' : 'Поиск аниме'}
        className="w-full rounded-lg border border-white/10 bg-bg-card px-4 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </form>
  );
}

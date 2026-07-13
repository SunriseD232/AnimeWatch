'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Поисковый инпут с debounce 400 мс. Меняет URL /search?q=...
 */
export default function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  useEffect(() => {
    const trimmed = value.trim();
    const handle = setTimeout(() => {
      if (trimmed.length === 0) return;
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }}
      className="relative"
      role="search"
    >
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Поиск аниме…"
        aria-label="Поиск аниме"
        className="w-full rounded-lg border border-white/10 bg-bg-card px-4 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </form>
  );
}

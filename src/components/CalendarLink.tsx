'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Календарь показывает только аниме (next_episode_at есть только у
 * Shikimori) — в разделе «Фильмы и сериалы» он бесполезен, поэтому прячем
 * ссылку там. Тот же паттерн определения раздела, что и в SearchBox.tsx.
 */
export default function CalendarLink() {
  const pathname = usePathname();
  if (pathname.startsWith('/cinema')) return null;

  return (
    <Link
      href="/calendar"
      aria-label="Календарь выхода серий"
      title="Календарь выхода серий"
      className="press hidden rounded-full px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5 hover:text-white sm:block"
    >
      📅
    </Link>
  );
}

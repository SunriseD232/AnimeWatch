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
      className="press hidden rounded-full p-2 text-gray-300 transition hover:bg-white/5 hover:text-white sm:block"
    >
      {/* Значок, а не эмодзи: рядом стоят колокольчик и профиль, нарисованные
          линией — 📅 выпадал из набора и на разных платформах рисовался
          по-своему (у Apple он цветной). */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-5 w-5 fill-none stroke-current"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    </Link>
  );
}

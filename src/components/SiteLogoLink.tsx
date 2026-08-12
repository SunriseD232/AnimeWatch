'use client';

import Link from 'next/link';

/**
 * Лого/название сайта в шапке — есть на КАЖДОЙ странице (Navbar), ведёт на
 * главную. Обычный Link: переход мгновенно показывает скелетон целевой
 * страницы (см. её loading.tsx / внутренний Suspense) — полноэкранный
 * спиннер поверх старой страницы только прятал бы этот скелетон.
 */
export default function SiteLogoLink() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center gap-2 text-lg font-bold"
    >
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-white">
        ▶
      </span>
      <span className="hidden sm:inline">MediaWatch</span>
    </Link>
  );
}

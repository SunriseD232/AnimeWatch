'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import type { ContentType } from '@/lib/types';
import { MODE_COOKIE, homeHref, modeFromPathname } from '@/lib/mode';

/**
 * Лого/название сайта в шапке — есть на КАЖДОЙ странице (Navbar), ведёт на
 * главную ТОГО раздела, где пользователь сейчас (или где был в прошлый раз,
 * если страница общая). Про то, почему адрес раздела, а не голый «/» —
 * см. lib/mode.ts.
 *
 * Обычный Link: переход мгновенно показывает скелетон целевой страницы
 * (см. её loading.tsx / внутренний Suspense) — полноэкранный спиннер поверх
 * старой страницы только прятал бы этот скелетон.
 */
export default function SiteLogoLink({ cookieMode }: { cookieMode: ContentType }) {
  const pathname = usePathname();
  const pathMode = modeFromPathname(pathname);
  const mode = pathMode ?? cookieMode;

  // Раздел, в который пользователь зашёл по прямой ссылке (тайтл кино из
  // поиска, страница серии), переключателя на главной не касается — куку
  // пишем сами, иначе middleware вернул бы его в прошлый раздел.
  useEffect(() => {
    if (!pathMode) return;
    document.cookie = `${MODE_COOKIE}=${pathMode}; path=/; max-age=31536000; samesite=lax`;
  }, [pathMode]);

  return (
    <Link
      href={homeHref(mode)}
      // prefetch={false} — по той же причине, что у переключателя разделов
      // (см. ModeSwitch): ссылка видна с первого рендера на каждой странице,
      // и её фоновый RSC-запрос ловил роутер в гонку с настоящим переходом.
      prefetch={false}
      className="flex shrink-0 items-center gap-2 text-lg font-bold"
    >
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-fg">
        ▶
      </span>
      <span className="hidden sm:inline">MediaWatch</span>
    </Link>
  );
}

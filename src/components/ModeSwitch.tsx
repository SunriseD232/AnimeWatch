'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { ContentType } from '@/lib/types';

const TABS: { value: ContentType; label: string; href: string }[] = [
  { value: 'anime', label: 'Аниме', href: '/' },
  { value: 'cinema', label: 'Фильмы и сериалы', href: '/cinema' },
];

/**
 * Кука последнего открытого раздела. Читается в middleware: заход на «/»
 * при aw_mode=cinema переносится на /cinema — сайт открывается там, где
 * пользователь был в прошлый раз.
 */
const MODE_COOKIE = 'aw_mode';

function setModeCookie(mode: ContentType) {
  document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Переключатель разделов вверху главной: «Аниме» ↔ «Фильмы и сериалы».
 * Сегментированный контрол на ссылках (route-based), активный подсвечен.
 */
export default function ModeSwitch({ active }: { active: ContentType }) {
  // Запоминаем открытый раздел (в т.ч. при прямом заходе по URL).
  useEffect(() => {
    setModeCookie(active);
  }, [active]);

  return (
    <div className="inline-flex rounded-full border border-white/10 bg-bg-card p-1">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            // Кука ставится ДО навигации: иначе middleware вернул бы
            // пользователя обратно в прошлый раздел.
            onClick={() => setModeCookie(tab.value)}
            // Без префетча: клик по вкладке должен вести ровно туда, куда
            // указывает подпись, а не в закэшированный редирект по cookie,
            // взятой на момент фонового префетча (см. middleware.ts).
            prefetch={false}
            className={[
              'press rounded-full px-4 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-accent text-white'
                : 'text-gray-300 hover:bg-bg-soft hover:text-white',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

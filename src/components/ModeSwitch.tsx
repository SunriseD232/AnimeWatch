'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { ContentType } from '@/lib/types';

// href «Аниме» — /?mode=anime, не голый '/': у него отдельный ключ
// клиентского Router Cache Next.js, независимый от '/' (который middleware
// при aw_mode=cinema редиректит на /cinema, см. middleware.ts) — иначе клик
// по «Аниме» иногда зацикливался обратно на /cinema через закэшированный
// редирект. Обычная (не голая) ссылка позволяет использовать next/link —
// полная перезагрузка страницы здесь больше не нужна и раньше обрывала
// Picture-in-Picture при переключении раздела.
const TABS: { value: ContentType; label: string; href: string }[] = [
  { value: 'anime', label: 'Аниме', href: '/?mode=anime' },
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
            // prefetch={false}: автопрефетч Next.js для этих ссылок (видимы в
            // шапке с самого рендера) может выстрелить вторым RSC-запросом
            // почти одновременно с реальным переходом по клику, поймав
            // клиентский роутер в ту же гонку, что уже чинили у /cinema/[id]
            // (см. CinemaCard) — итог: пустая страница после переключения
            // раздела без ошибки в консоли.
            prefetch={false}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              // Кука ставится синхронно ДО перехода (обычная навигация
              // Link, без ручного router.push) — иначе middleware вернул бы
              // пользователя обратно в прошлый раздел. Сам переход мгновенно
              // показывает скелетон целевой страницы (см. её loading.tsx /
              // внутренний Suspense) — полноэкранный спиннер поверх старой
              // страницы больше не нужен и только прятал этот скелетон.
              if (!isActive) setModeCookie(tab.value);
            }}
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

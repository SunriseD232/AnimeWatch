'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
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
  const router = useRouter();
  // Переход Аниме↔Кино тянет за собой полностью другую страницу (свежий
  // рендер Navbar/каталога/т.д.) — старая страница ещё видна и кликабельна,
  // пока грузится новая, что выглядело как зависание/ничего-не-происходит.
  // isPending от useTransition — единственный способ узнать, что переход
  // ещё не завершился (у next/link в этой версии Next нет своего пропа для
  // этого), для чего клик обрабатываем вручную через router.push вместо
  // обычной навигации по href.
  const [isPending, startTransition] = useTransition();

  // Запоминаем открытый раздел (в т.ч. при прямом заходе по URL).
  useEffect(() => {
    setModeCookie(active);
  }, [active]);

  return (
    <>
      <div className="inline-flex rounded-full border border-white/10 bg-bg-card p-1">
        {TABS.map((tab) => {
          const isActive = tab.value === active;
          return (
            <Link
              key={tab.value}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              onClick={(e) => {
                if (isActive) return;
                e.preventDefault();
                // Кука ставится ДО навигации: иначе middleware вернул бы
                // пользователя обратно в прошлый раздел.
                setModeCookie(tab.value);
                startTransition(() => {
                  router.push(tab.href);
                });
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

      {isPending && (
        <div
          role="status"
          aria-label="Загрузка"
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
        >
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      )}
    </>
  );
}

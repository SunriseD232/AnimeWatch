'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ContentType } from '@/lib/types';
import { MODE_COOKIE, homeHref } from '@/lib/mode';
import { SlidingPill, useSlidingPill } from '@/components/useSlidingPill';

// Оба раздела — короткими адресами '/?mode=...', симметрично. У «Аниме»
// это ещё и обход кэша: /?mode=anime — отдельный ключ
// клиентского Router Cache Next.js, независимый от '/' (который middleware
// при aw_mode=cinema редиректит на /cinema, см. middleware.ts) — иначе клик
// по «Аниме» иногда зацикливался обратно на /cinema через закэшированный
// редирект. Обычная (не голая) ссылка позволяет использовать next/link —
// полная перезагрузка страницы здесь больше не нужна и раньше обрывала
// Picture-in-Picture при переключении раздела.
const TABS: { value: ContentType; label: string; href: string }[] = [
  { value: 'anime', label: 'Аниме', href: homeHref('anime') },
  { value: 'cinema', label: 'Фильмы и сериалы', href: homeHref('cinema') },
];

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

  // Какую вкладку подсвечивать ПРЯМО СЕЙЧАС. Обычно это active из пропа, но
  // на время перехода — та, по которой кликнули: серверный рендер соседнего
  // раздела занимает сотни миллисекунд, и всё это время подсветка оставалась
  // на старой вкладке. Выглядело так, будто клик не сработал.
  const [optimistic, setOptimistic] = useState<ContentType | null>(null);
  const shown = optimistic ?? active;

  // Переход состоялся — отпускаем оптимистичное состояние.
  useEffect(() => {
    setOptimistic(null);
  }, [active]);

  const { rootRef, setTabRef, pill } = useSlidingPill(shown);

  return (
    <div
      ref={rootRef}
      // self-start обязателен: все родители переключателя — flex-колонки, а
      // в них элемент по умолчанию растягивается на всю ширину (inline-flex
      // у flex-элемента браузер приводит к flex). Контрол шириной в две
      // вкладки уезжал рамкой на 1120px, с пустым хвостом на весь экран.
      className="relative inline-flex self-start rounded-full border border-white/10 bg-bg-card p-1"
    >
      <SlidingPill pill={pill} />
      {TABS.map((tab) => {
        const isActive = tab.value === shown;
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
            ref={setTabRef(tab.value)}
            onClick={() => {
              // Кука ставится синхронно ДО перехода (обычная навигация
              // Link, без ручного router.push) — иначе middleware вернул бы
              // пользователя обратно в прошлый раздел. Сам переход мгновенно
              // показывает скелетон целевой страницы (см. её loading.tsx /
              // внутренний Suspense) — полноэкранный спиннер поверх старой
              // страницы больше не нужен и только прятал этот скелетон.
              if (tab.value === active) return;
              setModeCookie(tab.value);
              setOptimistic(tab.value);
            }}
            className={[
              'press relative z-10 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200',
              isActive ? 'text-accent-fg' : 'text-gray-300 hover:text-white',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

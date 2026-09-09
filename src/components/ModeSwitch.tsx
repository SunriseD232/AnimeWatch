'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

  // Ползунок под активной вкладкой. Ширины у вкладок разные («Аниме» против
  // «Фильмы и сериалы»), поэтому позицию и ширину меряем, а не считаем по
  // доле: с фиксированной долей ползунок либо не докрывал бы длинную
  // подпись, либо торчал за короткую.
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const el = tabRefs.current[shown];
      if (!root || !el) return;
      const r = root.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      setPill({ left: t.left - r.left, width: t.width });
    };
    measure();

    // Ширина подписи меняется от шрифта и языка интерфейса, а положение — от
    // ширины окна: без наблюдателя ползунок разъезжался с вкладкой.
    const observer = new ResizeObserver(measure);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div
      ref={rootRef}
      className="relative inline-flex rounded-full border border-white/10 bg-bg-card p-1"
    >
      {/* Ползунок отдельным слоем под подписями: так он переезжает между
          вкладками одним движением, а не гасится на одной и зажигается на
          другой. Пока не измерен — не рисуем вовсе, иначе первый кадр
          показал бы его в левом углу и он бы «прыгнул» на место. */}
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-1 z-0 rounded-full bg-accent transition-[transform,width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            height: 'calc(100% - 0.5rem)',
            width: pill.width,
            transform: `translateX(${pill.left}px)`,
            left: 0,
          }}
        />
      )}
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
            ref={(el) => {
              tabRefs.current[tab.value] = el;
            }}
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
              isActive ? 'text-white' : 'text-gray-300 hover:text-white',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

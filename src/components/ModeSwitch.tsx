'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ContentType } from '@/lib/types';
import { MODE_COOKIE, sectionHref } from '@/lib/mode';
import { SlidingPill, useSlidingPill } from '@/components/useSlidingPill';

// Оба раздела — короткими адресами '/?mode=...', симметрично. У «Аниме»
// это ещё и обход кэша: /?mode=anime — отдельный ключ
// клиентского Router Cache Next.js, независимый от '/' (который middleware
// при aw_mode=cinema редиректит на /cinema, см. middleware.ts) — иначе клик
// по «Аниме» иногда зацикливался обратно на /cinema через закэшированный
// редирект. Обычная (не голая) ссылка позволяет использовать next/link —
// полная перезагрузка страницы здесь больше не нужна и раньше обрывала
// Picture-in-Picture при переключении раздела.
// Адрес у вкладки не фиксированный: он зависит от того, где мы сейчас —
// из каталога переключатель ведёт в каталог соседнего раздела, а не на
// главную (см. sectionHref в lib/mode.ts).
//
// Подкасты, книги, ранобэ и манга — в том же ряду: это такие же разделы
// сайта, и стоять отдельно от «Аниме / Фильмы и сериалы» (как было пунктами
// навигации справа) им незачем. У них свой адрес (path) и нет куки раздела:
// кука aw_mode помнит только аниме/кино — по ней логотип и «/» ведут на
// главную нужного видео-раздела.
const TABS: { value: ContentType; label: string; short: string; path?: string }[] = [
  { value: 'anime', label: 'Аниме', short: 'Аниме' },
  { value: 'cinema', label: 'Фильмы и сериалы', short: 'Кино' },
  { value: 'podcast', label: 'Подкасты', short: 'Подкасты', path: '/podcasts' },
  { value: 'book', label: 'Книги', short: 'Книги', path: '/books' },
  { value: 'ranobe', label: 'Ранобэ', short: 'Ранобэ', path: '/ranobe' },
  { value: 'manga', label: 'Манга', short: 'Манга', path: '/manga' },
];

/** Раздел по пути — для подкастов/книг/ранобэ/манги; null — видео-раздел. */
function sectionFromPath(pathname: string): ContentType | null {
  const tab = TABS.find(
    (t) => t.path && (pathname === t.path || pathname.startsWith(`${t.path}/`)),
  );
  return tab ? tab.value : null;
}

function setModeCookie(mode: ContentType) {
  document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Переключатель разделов: «Аниме», «Фильмы и сериалы», подкасты, книги,
 * ранобэ и манга. Живёт в шапке рядом
 * с логотипом (см. HeaderNav.tsx), раньше стоял поверх баннера главной и над
 * каталогом — оттуда убран, чтобы не было двух одинаковых контролов.
 * Сегментированный контрол на ссылках (route-based), активный подсвечен.
 *
 * compact — вариант для шапки: до xl «Кино» вместо «Фильмы и сериалы» и
 * отступы плотнее, иначе поиску рядом не оставалось места (с xl, а не lg —
 * с тех пор как в ряду шесть разделов).
 */
export default function ModeSwitch({
  active,
  compact = false,
}: {
  active: ContentType;
  compact?: boolean;
}) {
  // Запоминаем открытый раздел (в т.ч. при прямом заходе по URL).
  useEffect(() => {
    setModeCookie(active);
  }, [active]);

  // Какую вкладку подсвечивать ПРЯМО СЕЙЧАС. Обычно это active из пропа, но
  // на время перехода — та, по которой кликнули: серверный рендер соседнего
  // раздела занимает сотни миллисекунд, и всё это время подсветка оставалась
  // на старой вкладке. Выглядело так, будто клик не сработал.
  const [optimistic, setOptimistic] = useState<ContentType | null>(null);
  const pathname = usePathname();
  // В разделе чтения/подкастов подсвечиваем его, а не аниме/кино из куки:
  // иначе на странице манги горели «Фильмы и сериалы».
  const current = sectionFromPath(pathname) ?? active;
  const shown = optimistic ?? current;

  // Переход состоялся — отпускаем оптимистичное состояние.
  useEffect(() => {
    setOptimistic(null);
  }, [current]);

  const { rootRef, setTabRef, pill } = useSlidingPill(shown);

  return (
    <div
      ref={rootRef}
      // self-start обязателен: все родители переключателя — flex-колонки, а
      // в них элемент по умолчанию растягивается на всю ширину (inline-flex
      // у flex-элемента браузер приводит к flex). Контрол шириной в две
      // вкладки уезжал рамкой на 1120px, с пустым хвостом на весь экран.
      className={[
        'relative inline-flex shrink-0 rounded-full border border-white/10 p-1',
        compact ? 'self-center bg-white/[0.04]' : 'self-start bg-bg-card',
      ].join(' ')}
    >
      <SlidingPill pill={pill} />
      {TABS.map((tab) => {
        const isActive = tab.value === shown;
        // На телефоне шесть вкладок рядом с лупой не помещаются: там остаются
        // «Аниме / Кино» и текущий раздел, а все разделы есть в нижнем доке
        // (MobileDock).
        const mobileHidden = Boolean(tab.path) && !isActive;
        return (
          <Link
            key={tab.value}
            href={tab.path ?? sectionHref(pathname, tab.value)}
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
              if (tab.value === current) return;
              // Кука — только для видео-разделов (см. TABS выше).
              if (!tab.path) setModeCookie(tab.value);
              setOptimistic(tab.value);
            }}
            className={[
              // whitespace-nowrap: без него «Фильмы и сериалы» переносится
              // на 2 строки в узких контейнерах (например, поверх hero на
              // мобильном) — пилюля вместо аккуратной формы превращается в
              // кривой прямоугольник. Ширина у rounded-full и так по
              // содержимому, переносить нечего.
              'press relative z-10 whitespace-nowrap rounded-full text-sm font-medium transition-colors duration-200',
              mobileHidden ? 'hidden md:inline-block' : '',
              compact ? 'px-3 py-1.5 sm:px-4' : 'px-4 py-2',
              isActive ? 'text-accent-fg' : 'text-gray-300 hover:text-white',
            ].join(' ')}
          >
            {compact ? (
              <>
                <span className="xl:hidden">{tab.short}</span>
                <span className="hidden xl:inline">{tab.label}</span>
              </>
            ) : (
              tab.label
            )}
          </Link>
        );
      })}
    </div>
  );
}

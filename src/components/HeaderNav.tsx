'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import type { ContentType } from '@/lib/types';
import { homeHref, modeFromPathname } from '@/lib/mode';
import ModeSwitch from './ModeSwitch';

/**
 * Разделы в шапке: «Главная», «Каталог», «Мой список».
 *
 * Адреса «Главной» и «Каталога» зависят от раздела — из кино ведут в кино
 * (тот же принцип, что у логотипа и нижнего дока, см. lib/mode.ts). «Мой
 * список» один на оба раздела: внутри профиля у него свой переключатель
 * «Аниме / Фильмы и сериалы».
 *
 * С xl — подписи, между md и xl — только значки: после появления книг,
 * ранобэ и манги в шапке семь ссылок, и на 1024–1279px подписи вместе с
 * переключателем раздела и поиском уже не помещались. На телефоне этих
 * ссылок нет вовсе — там нижний док (MobileDock).
 */
/**
 * Раздел, в котором человек сейчас. Путь — первым, но одного пути мало:
 * «/?mode=cinema» middleware переписывает в страницу кино, а в адресной
 * строке (и в usePathname) остаётся «/». Поэтому на «/» смотрим ещё и на
 * параметр mode, и только потом — на куку.
 */
function useSectionMode(cookieMode: ContentType): ContentType {
  const pathname = usePathname();
  const params = useSearchParams();
  const fromPath = modeFromPathname(pathname);
  if (fromPath) return fromPath;
  const fromQuery = pathname === '/' ? params.get('mode') : null;
  if (fromQuery === 'cinema' || fromQuery === 'anime') return fromQuery;
  return cookieMode;
}

// Suspense вокруг useSearchParams обязателен: шапка есть на статических
// страницах, и без границы сборка падает на пререндере. Пока параметры не
// прочитаны, показываем то же самое по куке — разметка совпадает в
// подавляющем большинстве случаев, без скачка.
export default function HeaderNav({ cookieMode }: { cookieMode: ContentType }) {
  return (
    <Suspense fallback={<HeaderNavView mode={cookieMode} />}>
      <HeaderNavLive cookieMode={cookieMode} />
    </Suspense>
  );
}

function HeaderNavLive({ cookieMode }: { cookieMode: ContentType }) {
  return <HeaderNavView mode={useSectionMode(cookieMode)} />;
}

function HeaderNavView({ mode }: { mode: ContentType }) {
  const pathname = usePathname();

  const isHome = pathname === '/' || pathname === '/cinema';
  const isCatalog = pathname === '/catalog' || pathname === '/cinema/catalog';
  const isPodcasts = pathname === '/podcasts' || pathname.startsWith('/podcasts/');
  const isBooks = pathname === '/books' || pathname.startsWith('/books/');
  const isRanobe = pathname === '/ranobe' || pathname.startsWith('/ranobe/');
  const isManga = pathname === '/manga' || pathname.startsWith('/manga/');

  return (
    <div className="hidden shrink-0 items-center gap-0.5 md:flex">
      <NavItem href={homeHref(mode)} label="Главная" active={isHome}>
        <path d="M3.5 10.5 12 4l8.5 6.5" />
        <path d="M5.5 9v10a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1V9" />
      </NavItem>
      <NavItem
        href={mode === 'cinema' ? '/cinema/catalog' : '/catalog'}
        label="Каталог"
        active={isCatalog}
      >
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </NavItem>
      {/* Подкасты — отдельный раздел, независимый от переключателя аниме/кино
          (у подкастов нет «версии для кино»). Значок микрофона — чтобы
          отличался от «Каталога» с его четырьмя плитками. */}
      <NavItem href="/podcasts" label="Подкасты" active={isPodcasts}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M6 11a6 6 0 0 0 12 0" />
        <path d="M12 17v4" />
      </NavItem>
      {/* Книги — тоже отдельный раздел по своему пути. Значок раскрытой
          книги: он не путается ни с сеткой «Каталога», ни с микрофоном. */}
      <NavItem href="/books" label="Книги" active={isBooks}>
        <path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H10a2 2 0 0 1 2 2v15a2.4 2.4 0 0 0-1.8-.8H4Z" />
        <path d="M20 5.2A2.2 2.2 0 0 0 17.8 3H14a2 2 0 0 0-2 2v15a2.4 2.4 0 0 1 1.8-.8H20Z" />
      </NavItem>
      {/* Ранобэ — отдельный раздел со своим источником (Renovels) и
          читателем. Значок свитка: книга уже занята «Книгами». */}
      <NavItem href="/ranobe" label="Ранобэ" active={isRanobe}>
        <path d="M7 4h9.5A2.5 2.5 0 0 1 19 6.5v13a1 1 0 0 1-1 1H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Z" />
        <path d="M8 4v12.5A2.5 2.5 0 0 0 5.5 19" />
        <path d="M11 8h4.5M11 11h4.5" />
      </NavItem>
      {/* Манга — отдельный раздел со своим источником (Remanga) и лентой
          страниц. Значок «облачко с текстом»: книга и свиток уже заняты. */}
      <NavItem href="/manga" label="Манга" active={isManga}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4 4v-3.5A2.5 2.5 0 0 1 4 13.5Z" />
        <path d="M8 7.5h8M8 11h5" />
      </NavItem>
      {/* Без подсветки активного: список — вкладка внутри профиля, и по
          одному пути не отличить её от «Истории» или «Настроек». */}
      <NavItem href="/profile?tab=list" label="Мой список" active={false}>
        <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z" />
      </NavItem>
    </div>
  );
}

function NavItem({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  /** Контур значка для средней ширины экрана (сетка 24×24, линией). */
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      // prefetch={false} — по той же причине, что у логотипа и ModeSwitch:
      // адрес раздела видим с первого рендера на каждой странице, и
      // автопрефетч ловит клиентский роутер в гонку с middleware.
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={[
        'press flex items-center rounded-full px-2 py-2 text-sm font-medium transition xl:px-3',
        active ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5 hover:text-white',
      ].join(' ')}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-5 w-5 fill-none stroke-current xl:hidden"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      {/* Подпись видна с xl, на средней ширине остаётся для скринридера. */}
      <span className="sr-only xl:not-sr-only xl:whitespace-nowrap">{label}</span>
    </Link>
  );
}

/**
 * Переключатель «Аниме / Фильмы и сериалы» в шапке. Раздел берём из пути, а
 * на общих страницах (профиль, поиск, плеер) — из куки: подсвечиваться должен
 * тот раздел, куда человек вернётся по логотипу.
 */
export function HeaderModeSwitch({ cookieMode }: { cookieMode: ContentType }) {
  return (
    <Suspense fallback={<ModeSwitch active={cookieMode} compact />}>
      <HeaderModeSwitchLive cookieMode={cookieMode} />
    </Suspense>
  );
}

function HeaderModeSwitchLive({ cookieMode }: { cookieMode: ContentType }) {
  return <ModeSwitch active={useSectionMode(cookieMode)} compact />;
}

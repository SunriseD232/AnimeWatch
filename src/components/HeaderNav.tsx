'use client';

import { readingCatalogHref } from '@/lib/readingFilters';
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
 * Разделы (аниме, кино, книги, ранобэ, манга, подкасты) здесь не стоят: они
 * в переключателе «Смотреть / Читать / Слушать» рядом с логотипом
 * (ModeSwitch).
 *
 * «Главная» и «Каталог» — всегда значками (однозначные, а строка шапки не
 * превращается в перечисление), «Мой список» — подписью с xl. На телефоне
 * этих ссылок нет вовсе — там нижний док (MobileDock).
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
  // В разделах чтения — их каталог с фильтрами (lib/readingFilters.ts),
  // иначе из манги значок уводил в каталог аниме.
  const readingCatalog = readingCatalogHref(pathname);
  const isCatalog =
    pathname === '/catalog' || pathname === '/cinema/catalog' || pathname === readingCatalog;

  return (
    <div className="hidden shrink-0 items-center gap-0.5 md:flex">
      <NavItem href={homeHref(mode)} label="Главная" active={isHome} iconOnly>
        <path d="M3.5 10.5 12 4l8.5 6.5" />
        <path d="M5.5 9v10a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1V9" />
      </NavItem>
      <NavItem
        href={readingCatalog ?? (mode === 'cinema' ? '/cinema/catalog' : '/catalog')}
        label="Каталог"
        active={isCatalog}
        iconOnly
      >
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
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
  iconOnly = false,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  /** Только значок на любой ширине (подпись — скринридеру и в title). Так
   *  «Главная» и «Каталог»: значки однозначные, а строка шапки рядом с
   *  переключателем разделов не превращается в перечисление. */
  iconOnly?: boolean;
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
        ['press flex items-center rounded-full px-2 py-2 text-sm font-medium transition', iconOnly ? '' : 'xl:px-3'].join(' '),
        active ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5 hover:text-white',
      ].join(' ')}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={['h-5 w-5 fill-none stroke-current', iconOnly ? '' : 'xl:hidden'].join(' ')}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      {/* Подпись видна с xl, на средней ширине остаётся для скринридера. */}
      <span className={iconOnly ? 'sr-only' : 'sr-only xl:not-sr-only xl:whitespace-nowrap'}>{label}</span>
    </Link>
  );
}

/**
 * Переключатель разделов в шапке (аниме, кино, подкасты, книги, ранобэ,
 * манга). Видео-раздел берём из пути, а
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

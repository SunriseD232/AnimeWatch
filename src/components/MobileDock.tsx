'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Нижняя док-панель для телефона: каталог — логотип — профиль.
 *
 * Зачем: на телефоне шапка держала логотип, поиск, колокольчик и «Профиль»
 * в одной строке шириной 375px, и поиску оставалась примерно половина.
 * Профиль и каталог переехали вниз, к большому пальцу, а поиск наверху
 * получил освободившееся место.
 *
 * Логотип посередине ведёт на главную — на голый «/», а не на конкретный
 * раздел: middleware сам перенесёт на /cinema, если пользователь последний
 * раз был там (кука aw_mode, см. ModeSwitch).
 *
 * Каталог, наоборот, зависит от раздела: из кино логично попадать в каталог
 * кино, а не аниме. Определяем по пути, а не по куке — путь честнее
 * показывает, где пользователь прямо сейчас.
 */
export default function MobileDock() {
  const pathname = usePathname();
  const isCinema = pathname.startsWith('/cinema');

  const catalogHref = isCinema ? '/cinema/catalog' : '/catalog';
  const isCatalog = pathname === '/catalog' || pathname === '/cinema/catalog';
  const isProfile = pathname.startsWith('/profile');
  const isHome = pathname === '/' || pathname === '/cinema';

  return (
    // pb с безопасной зоной — на самой панели: fixed-элемент не наследует
    // отступ body, и без этого подписи заезжали бы под полоску-индикатор
    // на iPhone. Верхняя граница вместо тени: панель полупрозрачная (glass),
    // и тень сквозь неё читалась бы грязным пятном.
    <nav
      aria-label="Основная навигация"
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
        <DockLink href={catalogHref} label="Каталог" active={isCatalog}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="2" />
            <rect x="14" y="3" width="7" height="7" rx="2" />
            <rect x="3" y="14" width="7" height="7" rx="2" />
            <rect x="14" y="14" width="7" height="7" rx="2" />
          </svg>
        </DockLink>

        {/* Логотип — крупнее соседей и без подписи: он и так узнаваем, а
            подпись «Главная» под ним только сбивала бы центр. */}
        <Link
          href="/"
          aria-label="На главную"
          aria-current={isHome ? 'page' : undefined}
          className="press flex shrink-0 items-center justify-center px-4 py-2"
        >
          <span
            className={[
              'grid h-11 w-11 place-items-center rounded-2xl transition',
              isHome ? 'bg-accent text-white' : 'bg-accent/15 text-accent',
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-current">
              <path d="M9 7.5v9a1 1 0 0 0 1.53.85l7.2-4.5a1 1 0 0 0 0-1.7l-7.2-4.5A1 1 0 0 0 9 7.5Z" />
            </svg>
          </span>
        </Link>

        <DockLink href="/profile" label="Профиль" active={isProfile}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
          </svg>
        </DockLink>
      </div>
    </nav>
  );
}

function DockLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'press flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium transition',
        active ? 'text-accent' : 'text-gray-400 hover:text-gray-200',
      ].join(' ')}
    >
      {children}
      {label}
    </Link>
  );
}

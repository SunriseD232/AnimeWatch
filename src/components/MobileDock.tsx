'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ContentType } from '@/lib/types';
import { homeHref, modeFromPathname } from '@/lib/mode';

/**
 * Нижняя док-панель для телефона: каталог — логотип — профиль.
 *
 * Зачем: на телефоне шапка держала логотип, поиск, колокольчик и «Профиль»
 * в одной строке шириной 375px, и поиску оставалась примерно половина.
 * Профиль и каталог переехали вниз, к большому пальцу, а поиск наверху
 * получил освободившееся место.
 *
 * Логотип посередине ведёт на главную ТОГО раздела, где пользователь
 * сейчас, а на общих страницах — где он был в прошлый раз (кука aw_mode).
 * Про то, почему адрес раздела, а не голый «/», — см. lib/mode.ts.
 *
 * Каталог, наоборот, зависит от раздела: из кино логично попадать в каталог
 * кино, а не аниме. Определяем по пути, а не по куке — путь честнее
 * показывает, где пользователь прямо сейчас.
 */
export default function MobileDock({
  cookieMode,
  hasFriendRequests = false,
}: {
  cookieMode: ContentType;
  /** Точка на «Профиле», пока кто-то ждёт ответа на заявку в друзья. */
  hasFriendRequests?: boolean;
}) {
  const pathname = usePathname();
  const isCinema = pathname.startsWith('/cinema');

  const catalogHref = isCinema ? '/cinema/catalog' : '/catalog';
  const isCatalog = pathname === '/catalog' || pathname === '/cinema/catalog';
  const isProfile = pathname.startsWith('/profile');
  const isHome = pathname === '/' || pathname === '/cinema';
  const isPodcasts = pathname === '/podcasts' || pathname.startsWith('/podcasts/');
  const isBooks = pathname === '/books' || pathname.startsWith('/books/');
  const isRanobe = pathname === '/ranobe' || pathname.startsWith('/ranobe/');
  const isManga = pathname === '/manga' || pathname.startsWith('/manga/');

  return (
    // pb с безопасной зоной — на самой панели: fixed-элемент не наследует
    // отступ body, и без этого подписи заезжали бы под полоску-индикатор
    // на iPhone. Верхняя граница вместо тени: панель полупрозрачная (glass),
    // и тень сквозь неё читалась бы грязным пятном.
    <nav
      aria-label="Основная навигация"
      // Плотнее шапочного стекла (0.72): под нижней панелью проезжает
      // контент — яркий постер сквозь полупрозрачный фон роняет контраст
      // мелких подписей ниже нормы (поймано axe). 0.94 + размытие держит
      // фон стабильно тёмным, подписи читаются на любом кадре прокрутки.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-bg-card/[0.94] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      {/* Одинаковая высота у всех пунктов: боковые — значок плюс подпись,
          средний — только кнопка. Без общей высоты кнопка «плей»
          растягивала док и сидела выше подписей. */}
      <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
        <DockLink href={catalogHref} label="Каталог" active={isCatalog}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="2" />
            <rect x="14" y="3" width="7" height="7" rx="2" />
            <rect x="3" y="14" width="7" height="7" rx="2" />
            <rect x="14" y="14" width="7" height="7" rx="2" />
          </svg>
        </DockLink>

        {/* Подкасты — свой раздел, а не продолжение каталога: путь отдельный
            (/podcasts) и на переключатель аниме/кино не завязан. */}
        <DockLink href="/podcasts" label="Подкасты" active={isPodcasts}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M6 11a6 6 0 0 0 12 0" />
            <path d="M12 17v4" />
          </svg>
        </DockLink>

        {/* Логотип — крупнее соседей и без подписи: он и так узнаваем, а
            подпись «Главная» под ним только сбивала бы центр. */}
        <Link
          href={homeHref(modeFromPathname(pathname) ?? cookieMode)}
          prefetch={false}
          aria-label="На главную"
          aria-current={isHome ? 'page' : undefined}
          className="press flex h-full shrink-0 items-center justify-center px-4"
        >
          <span
            className={[
              'grid h-12 w-12 place-items-center rounded-2xl transition',
              isHome ? 'bg-accent text-accent-fg' : 'bg-accent/15 text-accent-text',
            ].join(' ')}
          >
            {/* Треугольник во всю плитку: на 24-й сетке он занимал меньше
                половины ширины и на сплошном акцентном фоне читался мелкой
                точкой — в отличие от логотипа в шапке, где он крупный. */}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 fill-current">
              <path d="M7.5 5.6v12.8a1.2 1.2 0 0 0 1.84 1.02l10.05-6.4a1.2 1.2 0 0 0 0-2.04L9.34 4.58A1.2 1.2 0 0 0 7.5 5.6Z" />
            </svg>
          </span>
        </Link>

        {/* Книги — после логотипа, перед профилем: раздел новый, но по
            частоте использования стоит рядом с подкастами, а «Профиль»
            остаётся крайним справа, к большому пальцу. */}
        <DockLink href="/books" label="Книги" active={isBooks}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H10a2 2 0 0 1 2 2v15a2.4 2.4 0 0 0-1.8-.8H4Z" />
            <path d="M20 5.2A2.2 2.2 0 0 0 17.8 3H14a2 2 0 0 0-2 2v15a2.4 2.4 0 0 1 1.8-.8H20Z" />
          </svg>
        </DockLink>

        {/* Ранобэ — свой раздел и свой источник, как «Книги». Значок свитка,
            чтобы отличался от раскрытой книги. */}
        <DockLink href="/ranobe" label="Ранобэ" active={isRanobe}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4h9.5A2.5 2.5 0 0 1 19 6.5v13a1 1 0 0 1-1 1H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Z" />
            <path d="M8 4v12.5A2.5 2.5 0 0 0 5.5 19" />
            <path d="M11 8h4.5M11 11h4.5" />
          </svg>
        </DockLink>

        {/* Манга — сразу после ранобэ, перед профилем. Значок облачка с
            текстом, чтобы не путался с книгой и свитком. */}
        <DockLink href="/manga" label="Манга" active={isManga}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4 4v-3.5A2.5 2.5 0 0 1 4 13.5Z" />
            <path d="M8 7.5h8M8 11h5" />
          </svg>
        </DockLink>

        <DockLink href="/profile" label="Профиль" active={isProfile} profileAnchor>
          <span className="relative">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
            {hasFriendRequests && (
              <>
                <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg" />
                <span className="sr-only">Есть заявки в друзья.</span>
              </>
            )}
          </span>
        </DockLink>
      </div>
    </nav>
  );
}

function DockLink({
  href,
  label,
  active,
  profileAnchor = false,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  /** К этой ссылке цепляется подсказка «загляните в профиль» (ProfileHint). */
  profileAnchor?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-profile-anchor={profileAnchor || undefined}
      aria-current={active ? 'page' : undefined}
      className={[
        'press flex h-full flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium leading-none transition',
        active ? 'text-accent-text' : 'text-gray-300 hover:text-white',
      ].join(' ')}
    >
      {children}
      {label}
    </Link>
  );
}

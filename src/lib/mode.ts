import type { ContentType } from '@/lib/types';

/**
 * Раздел сайта (аниме / кино) — куда возвращать пользователя.
 *
 * Раздел живёт в куке `aw_mode`: её пишет переключатель на главной
 * (components/ModeSwitch.tsx) и читает middleware, чтобы заход на голый «/»
 * открывал тот раздел, где пользователь был в прошлый раз.
 *
 * Куки одной мало: на «/» ссылается логотип в шапке, а он виден на каждой
 * странице — Next.js префетчит такую ссылку заранее, и middleware этот
 * префетч намеренно пропускает без редиректа (иначе он отравляет клиентский
 * кэш, см. комментарий в middleware.ts). Клик по уже префетченной «/»
 * проходит из кэша мимо middleware — и раздел терялся. Поэтому логотип
 * ведёт не на «/», а на адрес раздела: у него свой ключ кэша и свой
 * маршрут через middleware.
 */

export const MODE_COOKIE = 'aw_mode';

export function normalizeMode(value: string | undefined | null): ContentType {
  return value === 'cinema' ? 'cinema' : 'anime';
}

/**
 * К какому разделу относится путь. `null` — путь общий (главная, профиль,
 * поиск, вход), раздел у него берётся из куки.
 *
 * Путь честнее куки: пользователь мог прийти на страницу кино по прямой
 * ссылке, ни разу не тронув переключатель.
 */
export function modeFromPathname(pathname: string): ContentType | null {
  if (pathname === '/cinema' || pathname.startsWith('/cinema/')) return 'cinema';
  if (
    pathname === '/catalog' ||
    pathname === '/new' ||
    pathname === '/popular' ||
    pathname === '/calendar' ||
    pathname.startsWith('/anime/') ||
    pathname.startsWith('/watch/')
  ) {
    return 'anime';
  }
  return null;
}

/** Короткий адрес раздела. Симметричная пара, оба — параметром к «/». */
export function homeHref(mode: ContentType): string {
  return mode === 'cinema' ? '/?mode=cinema' : '/?mode=anime';
}

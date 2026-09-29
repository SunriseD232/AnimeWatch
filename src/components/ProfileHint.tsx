'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Зеркало флага profiles.profile_hint_seen на этом устройстве. */
const SEEN_KEY = 'mw:profileHintSeen';
/** Не сразу после загрузки: сначала человек видит страницу, потом подсказку. */
const SHOW_DELAY_MS = 1500;

/** Где подсказке не место: плеер (серия идёт — не мешаем) и вход/регистрация. */
function isQuietPath(pathname: string): boolean {
  return (
    pathname.startsWith('/watch/') ||
    pathname.startsWith('/cinema/watch/') ||
    pathname === '/login' ||
    pathname === '/signup'
  );
}

type Box =
  | { place: 'below'; top: number; left: number; arrowLeft: number }
  | { place: 'above'; bottom: number; left: number; arrowLeft: number };

const WIDTH = 300;
const GUTTER = 16;

/**
 * Разовая подсказка «загляните в профиль»: там оформление, фон, настройки
 * плеера и поиска, история и оценки — а многие про профиль и не знают.
 *
 * ОДИН раз на аккаунт: флаг profiles.profile_hint_seen (миграция 0047)
 * приходит пропом `show` из Navbar, закрытие пишется туда же через
 * PATCH /api/profile. Закрыл на телефоне — на компьютере её уже не будет.
 * localStorage — только зеркало, чтобы подсказка пропала сразу и не
 * вернулась до ответа сервера.
 *
 * Прицеплена к значку профиля: на компьютере он в шапке, на телефоне — в
 * нижнем доке. Оба помечены data-profile-anchor, берём тот, что сейчас
 * виден (у скрытого нулевой размер). Нет видимого — например, поиск
 * развернули на всю шапку — подсказка ждёт, а не висит в пустоте.
 *
 * Не забирает фокус и не блокирует страницу: это предложение, а не
 * диалог, который надо пройти. Закрывается «Понятно», Esc, переходом в
 * профиль по ссылке или любым заходом в профиль самостоятельно.
 */
export default function ProfileHint({ show }: { show: boolean }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const rafRef = useRef(0);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* приватный режим — сервер всё равно запомнит */
    }
    fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileHintSeen: true }),
    }).catch(() => {});
  }, []);

  // Решаем, показывать ли вообще, — один раз после монтирования.
  useEffect(() => {
    if (!show) return;
    try {
      if (window.localStorage.getItem(SEEN_KEY) === '1') return;
    } catch {
      /* нет доступа к хранилищу — полагаемся на сервер */
    }
    const timer = setTimeout(() => setReady(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [show]);

  // Сам зашёл в профиль — подсказка своё дело сделала.
  useEffect(() => {
    if (ready && !dismissed && pathname.startsWith('/profile')) dismiss();
  }, [ready, dismissed, pathname, dismiss]);

  const active = ready && !dismissed && !isQuietPath(pathname) && !pathname.startsWith('/profile');

  // Положение — от видимого значка профиля; пересчитываем при изменении
  // размеров окна и прокрутке (док и шапка закреплены, но на всякий случай).
  useEffect(() => {
    if (!active) {
      setBox(null);
      return;
    }
    const measure = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const anchor = Array.from(document.querySelectorAll<HTMLElement>('[data-profile-anchor]'))
          .map((el) => el.getBoundingClientRect())
          .find((r) => r.width > 0 && r.height > 0);
        if (!anchor) {
          setBox(null);
          return;
        }
        const vw = window.innerWidth;
        const width = Math.min(WIDTH, vw - GUTTER * 2);
        const center = anchor.left + anchor.width / 2;
        const left = Math.min(Math.max(center - width + 28, GUTTER), vw - width - GUTTER);
        const arrowLeft = Math.min(Math.max(center - left, 16), width - 16);
        // Значок в верхней половине экрана — шапка, окно под ним; в нижней —
        // док телефона, окно над ним.
        setBox(
          anchor.top < window.innerHeight / 2
            ? { place: 'below', top: anchor.bottom + 10, left, arrowLeft }
            : { place: 'above', bottom: window.innerHeight - anchor.top + 10, left, arrowLeft },
        );
      });
    };
    measure();
    // Шапка может перестроиться (развернули и свернули поиск, подгрузился
    // аватар) — наблюдаем за ней, а не только за окном.
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    const header = document.querySelector('header');
    if (header) ro.observe(header);
    const mo = new MutationObserver(measure);
    if (header) mo.observe(header, { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, dismiss]);

  if (!active || !box) return null;

  const width = Math.min(WIDTH, typeof window === 'undefined' ? WIDTH : window.innerWidth - GUTTER * 2);

  return (
    <div
      role="dialog"
      aria-labelledby="profile-hint-title"
      aria-describedby="profile-hint-text"
      className="animate-hint-in fixed z-50 rounded-2xl border border-white/10 bg-bg-card/95 p-4 text-sm shadow-2xl backdrop-blur-xl"
      style={
        box.place === 'below'
          ? { top: box.top, left: box.left, width }
          : { bottom: box.bottom, left: box.left, width }
      }
    >
      {/* Стрелка к значку профиля — повёрнутый квадрат в цвет окна. */}
      <span
        aria-hidden="true"
        className={[
          'absolute h-3 w-3 rotate-45 border-white/10 bg-bg-card',
          box.place === 'below' ? '-top-1.5 border-l border-t' : '-bottom-1.5 border-b border-r',
        ].join(' ')}
        style={{ left: box.arrowLeft - 6 }}
      />
      <p id="profile-hint-title" className="font-semibold text-gray-100">
        Загляните в профиль
      </p>
      <p id="profile-hint-text" className="mt-1 leading-snug text-gray-300">
        Там можно сменить цвет и живой фон сайта, настроить плеер и поиск, посмотреть историю и
        свои оценки.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/profile?tab=ui"
          onClick={dismiss}
          className="press rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg transition hover:bg-accent-hover"
        >
          Открыть оформление
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="press rounded-full px-3 py-1.5 text-sm text-gray-300 transition hover:bg-white/5 hover:text-white"
        >
          Понятно
        </button>
      </div>
    </div>
  );
}

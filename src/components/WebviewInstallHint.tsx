'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

const HINT_SEEN_KEY = 'aw:webviewHintSeen';

/** window.navigator.standalone — не входит в стандартный lib.dom.d.ts
 *  (WebKit-only признак «уже открыто как добавленное на экран «Домой»»). */
interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

/**
 * Разовая подсказка «можно добавить сайт на экран «Домой» как приложение» —
 * см. полную инструкцию в app/tips/page.tsx (#iphone-app), сюда выводим
 * только короткий баннер со ссылкой туда. Показываем один раз и только
 * когда это реально применимо:
 * - НЕ в нативном приложении (Capacitor) — там это уже приложение, а не
 *   вебвью, подсказка про него бессмысленна;
 * - НЕ если уже открыто как добавленное на «Домой» (navigator.standalone —
 *   WebKit-специфичный признак, но именно iOS тут и важен) — пользователь
 *   уже это сделал;
 * - только на iPhone/iPad (UA) — инструкция «Поделиться → На экран «Домой»»
 *   специфична для iOS, на Android у большинства браузеров есть свой,
 *   более настойчивый нативный баннер «Установить приложение», подсказка
 *   от нас там не нужна;
 * - НЕ если уже показывали (localStorage, aw:webviewHintSeen).
 *
 * Не auto-dismiss, как обычные тосты (см. ToastProvider) — тут не короткое
 * «готово», а предложение, которое нужно время прочитать и, возможно,
 * пойти по ссылке; закрывается только явным крестиком.
 */
export default function WebviewInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (typeof window === 'undefined') return;
    if ((window.navigator as NavigatorStandalone).standalone === true) return;
    if (window.localStorage.getItem(HINT_SEEN_KEY) === '1') return;

    const isIOS = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
    if (!isIOS) return;

    setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(HINT_SEEN_KEY, '1');
    } catch {
      /* приватный режим и т.п. — просто не запомнится между визитами */
    }
  };

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 flex items-start gap-3 rounded-xl bg-bg-card/95 p-3 text-sm shadow-lg ring-1 ring-white/10 backdrop-blur sm:inset-x-auto sm:left-4 sm:max-w-sm sm:bottom-4"
    >
      <span className="flex-1 leading-relaxed text-gray-200">
        Совет: MediaWatch можно добавить на экран «Домой» — откроется на весь
        экран, как приложение.{' '}
        <Link
          href="/tips#iphone-app"
          onClick={dismiss}
          className="font-medium text-accent-text underline underline-offset-2"
        >
          Как это сделать
        </Link>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Закрыть подсказку"
        className="press -m-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Ловит ошибки в самом root layout (обычный error.tsx их не перехватывает,
 * т.к. рендерится внутри того же layout). Заменяет весь <html>, поэтому
 * рисует свою минимальную разметку без Navbar/ToastProvider.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ru" className="dark">
      <body className="grid min-h-screen place-items-center bg-black font-sans text-white">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="text-5xl">😵</div>
          <h1 className="text-2xl font-bold">Что-то пошло не так</h1>
          <p className="text-sm text-gray-400">
            Произошла критическая ошибка. Попробуйте перезагрузить страницу.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
          >
            Повторить
          </button>
        </div>
      </body>
    </html>
  );
}

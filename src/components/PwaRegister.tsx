'use client';

import { useEffect } from 'react';

/** Регистрирует /sw.js — нужен только для критериев установки PWA (см. public/sw.js). */
export default function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Не критично — сайт и без SW работает как обычная страница.
      });
    }
  }, []);

  return null;
}

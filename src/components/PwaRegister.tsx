'use client';

import { useEffect } from 'react';

/**
 * Чистит следы отменённого PWA-эксперимента: на мобильных зарегистрированный
 * sw.js ломал рендер (открывался сырой HTML вместо страницы). Файлы удалены,
 * но у части телефонов service worker уже установлен и продолжит
 * контролировать сайт, пока его явно не отписать — просто удалить sw.js на
 * сервере для этого недостаточно.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
  }, []);

  return null;
}

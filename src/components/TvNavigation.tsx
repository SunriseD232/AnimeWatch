'use client';

import { useEffect } from 'react';
import { isTvUserAgent, handleTvKeyDown } from '@/lib/tvNav';

/**
 * Включает навигацию стрелками пульта Android TV (см. src/lib/tvNav.ts) —
 * монтируется всегда (как NativeAuthBridge.tsx/PresenceHeartbeat.tsx), но
 * реально что-то делает только внутри Android TV-обёртки (см.
 * capacitor.config.ts, isTvUserAgent()). Обычный браузер/iOS-обёртку не
 * трогает вообще.
 *
 * data-tv на <html> — переключатель CSS-кольца фокуса (см. globals.css,
 * html[data-tv] :focus-visible) — без него сфокусированные пультом
 * элементы визуально неотличимы от несфокусированных, потому что сайт
 * местами гасит контур под мышиный клик (focus:outline-none).
 */
export default function TvNavigation() {
  useEffect(() => {
    if (!isTvUserAgent()) return;
    document.documentElement.dataset.tv = 'true';
    window.addEventListener('keydown', handleTvKeyDown);
    return () => window.removeEventListener('keydown', handleTvKeyDown);
  }, []);

  return null;
}

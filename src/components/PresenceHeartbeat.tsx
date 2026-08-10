'use client';

import { useEffect } from 'react';

const HEARTBEAT_MS = 45_000;

/**
 * Раз в ~45 секунд, пока вкладка видима, сообщает серверу «я тут сейчас» —
 * см. /api/presence/heartbeat и getOnlineUserCount в lib/admin.ts (бейдж
 * «сейчас онлайн» в шапке для админов). Смонтирован глобально в layout.tsx;
 * для анонимов эндпоинт просто ничего не пишет — отдельно фильтровать тут
 * не нужно.
 */
export default function PresenceHeartbeat() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/presence/heartbeat', { method: 'POST', keepalive: true }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', ping);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', ping);
    };
  }, []);

  return null;
}

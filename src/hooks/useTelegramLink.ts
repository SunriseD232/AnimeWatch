'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Хук получения привязанного Telegram ID текущего пользователя.
 */
export function useTelegramLink() {
  const [tgId, setTgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/link');
      if (res.ok) {
        const data = await res.json();
        setTgId(data.telegram_id ?? null);
      } else {
        setTgId(null);
      }
    } catch {
      setTgId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tgId, loading, refresh };
}

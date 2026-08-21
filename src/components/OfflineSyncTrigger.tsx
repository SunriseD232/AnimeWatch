'use client';

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { OfflineDownload } from '@/native/offlineDownload';

/**
 * Синхронизирует накопленный офлайн-прогресс (см. OfflineDownloadManager.
 * saveLastPosition/getPendingProgress — копится time observer'ом офлайн-
 * плеера, DownloadPlayerView.swift) при восстановлении сети. Сравнение
 * «кто дальше» (season → episode → position) делает сервер — см.
 * /api/progress/sync и его комментарий про офлайн-часы телефона.
 *
 * Только нативная платформа — на вебе всегда online, синхронизировать
 * нечего. Смонтирован глобально в layout.tsx, как PresenceHeartbeat/
 * NativeAuthBridge.
 */
export default function OfflineSyncTrigger() {
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function sync() {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const { items } = await OfflineDownload.getPendingProgress();
        if (items.length === 0) return;
        const res = await fetch('/api/progress/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) return; // не авторизован/сеть моргнула — очередь остаётся, попробуем на следующем реконнекте
        const data: { results?: { key: string }[] } = await res.json();
        const keys = (data.results ?? []).map((r) => r.key);
        // Очищаем В ОБОИХ случаях (applied true/false) — сервер уже сверился
        // с этой записью и либо принял её, либо явно сказал, что он и так
        // дальше; хранить запись дальше в очереди незачем в любом случае.
        if (keys.length > 0) {
          await OfflineDownload.clearSyncedProgress({ keys });
        }
      } catch {
        // Тихо — очередь останется на диске, следующий реконнект попробует снова.
      } finally {
        syncingRef.current = false;
      }
    }

    // Безусловный прогон при монтировании — страховка на случай, если
    // событие реконнекта ниже пропущено (сеть уже была при старте приложения).
    sync();

    let removeListener: (() => void) | null = null;
    Network.addListener('networkStatusChange', (status) => {
      if (status.connected) sync();
    }).then((handle) => {
      removeListener = () => {
        handle.remove().catch(() => {});
      };
    });

    return () => {
      removeListener?.();
    };
  }, []);

  return null;
}

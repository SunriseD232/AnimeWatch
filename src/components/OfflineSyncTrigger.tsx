'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { OfflineDownload } from '@/native/offlineDownload';

const POLL_INTERVAL_MS = 20_000;

/**
 * Синхронизирует накопленный офлайн-прогресс (см. OfflineDownloadManager.
 * saveLastPosition/getPendingProgress — копится time observer'ом офлайн-
 * плеера, DownloadPlayerView.swift). Сравнение «кто дальше» (season →
 * episode → position) делает сервер — см. /api/progress/sync и его
 * комментарий про офлайн-часы телефона.
 *
 * Триггеры сразу три, не один:
 *  1. Реконнект сети (networkStatusChange) — исходный сценарий: посмотрели
 *     офлайн-плеер БЕЗ сети, интернет вернулся.
 *  2. document.visibilitychange — телефон вернулся из фона.
 *  3. Периодический опрос (POLL_INTERVAL_MS) — самый важный на практике:
 *     таб-бар в SceneDelegate.swift держит вкладку «MediaWatch» (этот
 *     WebView) и нативную «Загрузки» СОСЕДНИМИ вкладками одного
 *     UITabBarController — переключение между ними НЕ выгружает и не
 *     скрывает WebView с точки зрения ОС (страница остаётся видимой,
 *     document.hidden не меняется) и НЕ считается сменой сетевого статуса.
 *     Другими словами: посмотрел скачанную серию в нативном плеере (сеть
 *     при этом обычно ЕСТЬ, просто плеер локальный) → вернулся на вкладку
 *     MediaWatch — ни один из первых двух триггеров не срабатывает вообще,
 *     прогресс так и остаётся только в pendingProgress.json на диске.
 *     Подтверждено вживую 2026-08-26 (сериал не появлялся/не обновлялся в
 *     «Продолжить просмотр» после просмотра скачанной серии). Опрос —
 *     самый надёжный способ не зависеть от того, долетит ли вообще какое-
 *     то системное событие досюда; сам sync() дешёвый и рано выходит, если
 *     очередь пуста (see getPendingProgress).
 *
 * Только нативная платформа — на вебе всегда online, синхронизировать
 * нечего. Смонтирован глобально в layout.tsx, как PresenceHeartbeat/
 * NativeAuthBridge.
 */
export default function OfflineSyncTrigger() {
  const syncingRef = useRef(false);
  const router = useRouter();

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
        if (!res.ok) return; // не авторизован/сеть моргнула — очередь остаётся, попробуем на следующем триггере
        const data: { results?: { key: string; applied: boolean }[] } = await res.json();
        const keys = (data.results ?? []).map((r) => r.key);
        // Очищаем В ОБОИХ случаях (applied true/false) — сервер уже сверился
        // с этой записью и либо принял её, либо явно сказал, что он и так
        // дальше; хранить запись дальше в очереди незачем в любом случае.
        if (keys.length > 0) {
          await OfflineDownload.clearSyncedProgress({ keys });
        }
        // Страница (например, «Продолжить просмотр» на главной), если уже
        // открыта, была отрендерена ДО этой синхронизации — её серверные
        // данные сами не перечитаются от смены строки в БД. router.refresh()
        // перезапрашивает Server Components текущего маршрута без потери
        // клиентского состояния — только если реально что-то применили,
        // иначе (пустой результат/всё отклонено как "сервер и так дальше")
        // перерисовывать нечего.
        if (data.results?.some((r) => r.applied)) {
          router.refresh();
        }
      } catch {
        // Тихо — очередь останется на диске, следующий триггер попробует снова.
      } finally {
        syncingRef.current = false;
      }
    }

    // Безусловный прогон при монтировании — страховка на случай, если
    // события ниже пропущены (сеть уже была при старте приложения).
    sync();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const intervalId = window.setInterval(sync, POLL_INTERVAL_MS);

    let removeListener: (() => void) | null = null;
    Network.addListener('networkStatusChange', (status) => {
      if (status.connected) sync();
    }).then((handle) => {
      removeListener = () => {
        handle.remove().catch(() => {});
      };
    });

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
      removeListener?.();
    };
    // router — стабильная ссылка в App Router, в зависимости не добавляем
    // рефом, чтобы не пересоздавать интервал/слушателей на каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

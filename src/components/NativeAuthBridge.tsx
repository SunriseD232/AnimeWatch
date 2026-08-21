'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { OfflineDownload } from '@/native/offlineDownload';

/**
 * Проталкивает состояние авторизации в нативный плагин OfflineDownload (см.
 * ios/App/App/OfflineDownloadManager.swift) — вкладка «Загрузки» в таб-баре
 * читает это состояние из UserDefaults независимо от WebView, поэтому веб-
 * сторона обязана явно сообщать его при каждой смене. Смонтирован глобально
 * в layout.tsx, как PresenceHeartbeat. На обычном вебе (не Capacitor) ничего
 * не делает.
 */
export default function NativeAuthBridge({
  isAuthed,
  userId,
}: {
  isAuthed: boolean;
  userId: string | null;
}) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    OfflineDownload.setAuthState({ isAuthed, userId }).catch(() => {});
  }, [isAuthed, userId]);

  return null;
}

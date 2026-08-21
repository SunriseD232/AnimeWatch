'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { createClient } from '@/lib/supabase/client';
import { OfflineDownload } from '@/native/offlineDownload';

/**
 * Проталкивает состояние авторизации в нативный плагин OfflineDownload (см.
 * ios/App/App/OfflineDownloadManager.swift) — вкладка «Загрузки» в таб-баре
 * читает это состояние из UserDefaults независимо от WebView, поэтому веб-
 * сторона обязана явно сообщать его при каждой смене.
 *
 * Раньше isAuthed приходил пропом с сервера (getCachedUser() в layout.tsx)
 * — оказалось ненадёжно: Next.js App Router кэширует уже посещённые layout-
 * сегменты между клиентскими переходами (staleTimes) и не гарантирует, что
 * корневой layout пересчитывается на каждую навигацию внутри WKWebView —
 * если САМАЯ ПЕРВАЯ загрузка страницы за сессию приложения попадала в
 * момент, когда getUser() на сервере подвисал (см. прод-инцидент
 * 2026-08-21 — Supabase Auth периодически подтормаживал), этот компонент
 * монтировался ОДИН РАЗ с isAuthed=false и больше никогда не обновлялся за
 * всю сессию приложения — вкладка «Загрузки» так и висела на «Войдите на
 * сайте», даже когда пользователь реально был залогинен.
 *
 * Подписка на onAuthStateChange браузерного клиента Supabase — локальный
 * источник правды: не зависит ни от кэша роутера, ни от серверного round-
 * trip. Отдаёт текущую сессию синхронно (из уже сохранённого токена) сразу
 * при подписке и дальше сама обновляется на login/logout/обновление токена
 * — то есть работает даже без единой успешной сетевой проверки.
 */
export default function NativeAuthBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      OfflineDownload.setAuthState({
        isAuthed: !!session?.user,
        userId: session?.user?.id ?? null,
      }).catch(() => {});
    });
    return () => subscription.unsubscribe();
  }, []);

  return null;
}

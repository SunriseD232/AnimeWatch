'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Клиент Supabase для использования в браузере (Client Components).
 *
 * cookieOptions.name — без явного имени @supabase/ssr сам выводит его из
 * хоста NEXT_PUBLIC_SUPABASE_URL (`sb-${hostname.split('.')[0]}-auth-token`)
 * — при миграции на self-hosted Supabase (другой хост) это имя тихо
 * поменялось бы, и все уже выставленные куки браузеров/iOS-приложения стали
 * бы «невидимы» для приложения, даже с тем же JWT-секретом и валидным
 * токеном. Пин на исходное имя (от Cloud-проекта ubqmltwcfbquenvcxbyl)
 * держит миграцию бесшовной для уже вошедших пользователей независимо от
 * того, куда сейчас указывает URL.
 */
const AUTH_COOKIE_NAME = 'sb-ubqmltwcfbquenvcxbyl-auth-token';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: AUTH_COOKIE_NAME } },
  );
}

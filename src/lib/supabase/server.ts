import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { supabaseFetch } from './fetchWithVless';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Клиент Supabase для Server Components / Route Handlers.
 * Сессия хранится в cookies через @supabase/ssr, что обеспечивает SSR.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Вызов из Server Component — установку cookies берёт на себя middleware.
          }
        },
      },
      global: { fetch: supabaseFetch },
    },
  );
}

/**
 * getUser() бьёт по Supabase auth за сетевым раунд-трипом (через
 * supabaseFetch — туннелируется через VLESS, но всё равно до 8с при
 * таймауте, см. фикс сетевого затыка этой VPS). Navbar (в layout) и КАЖДАЯ
 * page.tsx серии/тайтла независимо зовут supabase.auth.getUser() — на один
 * заход пользователя набегает 2-3 ОТДЕЛЬНЫХ раунд-трипа за одним и тем же
 * (проверено вживую: цепочка из нескольких getUser()-таймаутов подряд на
 * watch-страницах суммарно даёт "Загружаем плеер..." на 15-20+с).
 * React.cache() дедуплицирует вызовы В РАМКАХ ОДНОГО SSR-рендера (тот же
 * механизм, что Next.js использует для автоматического fetch-дедупа) — так
 * что Navbar и page.tsx получают ОДИН реальный сетевой вызов на двоих, а не
 * по одному каждый.
 */
export const getCachedUser = cache(async () => {
  return createClient().auth.getUser();
});

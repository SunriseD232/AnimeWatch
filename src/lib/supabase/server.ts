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
 * getUser() ВСЕГДА бьёт по Supabase auth сетевым раунд-трипом — даже когда
 * JWT в куке ещё валиден — потому что он намеренно перепроверяет живой
 * статус пользователя на сервере Supabase (забанен/удалён и т.п.), а не
 * просто верифицирует подпись токена. На этой VPS такой раунд-трип идёт
 * через VLESS-туннель (см. fetchWithVless.ts) — обычно ~0.4с, но при сбое
 * САМОГО туннеля до 8с на таймаут. Раньше Navbar (в layout) и КАЖДАЯ
 * page.tsx серии/тайтла независимо зависели от этого — на один заход
 * пользователя набегало 2-3 ОТДЕЛЬНЫХ раунд-трипа за одним и тем же
 * (проверено вживую: цепочка из нескольких getUser()-таймаутов подряд на
 * watch-страницах суммарно давала "Загружаем плеер..." на 15-20+с; отдельно
 * проверено вживую 2026-08-21 — тот же таймаут срабатывал массово и на
 * КАЖДОЙ странице/heartbeat-запросе сразу у ВСЕХ пользователей, из-за чего
 * сайт целиком на несколько секунд считал всех гостями).
 *
 * getSession() — тот же JWT из cookie, но БЕЗ сетевого похода, если токен
 * ещё не истёк: middleware (см. middleware.ts) уже прогоняет/обновляет
 * сессию на каждый запрос ДО того, как сюда доходит дело (хоть его
 * собственный getUser() почти всегда сам глохнет от того же сетевого
 * затыка — короткий таймаут+fail-open там намеренный, см. комментарий в
 * middleware.ts), так что к моменту рендера страницы кука уже настолько
 * свежая, насколько вообще возможно за этот запрос — заново дёргать
 * Supabase тут ради того же самого смысла нет. Настоящая проверка
 * актуальности (бан/удаление) всё равно происходит на любой реальной
 * мутации данных через RLS. React.cache() дедуплицирует вызовы В РАМКАХ
 * ОДНОГО SSR-рендера — Navbar и page.tsx получают один вызов на двоих.
 */
export const getCachedUser = cache(async () => {
  try {
    const { data, error } = await createClient().auth.getSession();
    return { data: { user: data.session?.user ?? null }, error };
  } catch (error) {
    // getSession() обычно не бьёт по сети (см. выше), НО если токен истёк,
    // она попытается его обновить — тот самый сетевой путь, для которого не
    // проверено вживую, что при сбое он тихо возвращает null, как getUser()
    // (см. middleware.ts), а не бросает исключение. Подстраховываемся так
    // же — не даём сбою обновления токена уронить рендер страницы.
    return { data: { user: null }, error };
  }
});

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { absoluteUrl } from '@/lib/site-url';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Обновляет сессию Supabase на каждом запросе и защищает приватные маршруты.
 * Возвращает response с актуализированными cookies.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
      // Не пробрасываем сюда supabaseFetch (VLESS-туннель) — этот клиент
      // работает в Edge Runtime (см. корневой middleware.ts), где недоступны
      // Node-специфичные API undici (dispatcher/ProxyAgent). Тот же сетевой
      // затык к Supabase здесь всё ещё возможен (см. lib/supabase/server.ts),
      // но фикс для Edge Runtime — отдельная задача (нужен другой механизм,
      // не туннель через undici).
    },
  );

  // ВАЖНО: не вставлять код между createServerClient и getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Публичные страницы — единственное, что доступно без входа. Всё
  // остальное (включая главную, каталоги, просмотр, /code) требует сессию:
  // сайт закрыт для незарегистрированных полностью, по требованию продукта.
  // API-роуты не редиректим — они сами возвращают 401/403 в JSON (редирект
  // на HTML-страницу входа сломал бы fetch-клиентов) и /api/signup,
  // /api/login обязаны быть доступны анониму по своей природе.
  const PUBLIC_PAGES = new Set(['/login', '/signup']);
  const isApiRoute = pathname.startsWith('/api/');
  const isPublicPage = PUBLIC_PAGES.has(pathname);

  if (!user && !isPublicPage && !isApiRoute) {
    const url = absoluteUrl('/login', request.url);
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Авторизованного не пускаем на страницы входа/регистрации.
  if (user && isPublicPage) {
    return NextResponse.redirect(absoluteUrl('/', request.url));
  }

  return supabaseResponse;
}

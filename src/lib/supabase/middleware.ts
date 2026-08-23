import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { absoluteUrl } from '@/lib/site-url';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// До миграции на self-hosted Supabase (2026-08-21) прямое соединение с
// облачным Supabase с этой VPS не просто было медленным, а ПОЛНОСТЬЮ висело
// без ответа — воспроизведено вживую: 10.7с на голову на любую защищённую
// страницу (middleware гоняет getUser() на каждый запрос). Теперь Supabase
// self-hosted на этой же VPS (supabase.media-watch.ru) — обычное соединение
// должно укладываться в доли секунды. Короткий таймаут с fail-open (не
// разлогинивать при сбое, см. try/catch ниже) оставлен как защита на случай
// реальной сетевой деградации, а не потому что путь заведомо не проходит —
// не путать со старой формулировкой этого комментария.
const MIDDLEWARE_AUTH_TIMEOUT_MS = 800;

function edgeFetchWithTimeout(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(MIDDLEWARE_AUTH_TIMEOUT_MS) });
}

// Без явного имени @supabase/ssr сам выводит его из хоста
// NEXT_PUBLIC_SUPABASE_URL — при миграции на self-hosted Supabase (другой
// хост) это тихо сломало бы уже существующие сессии, см. тот же пин и
// комментарий в client.ts.
const AUTH_COOKIE_NAME = 'sb-ubqmltwcfbquenvcxbyl-auth-token';

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
      // Не пробрасываем сюда supabaseFetch (см. fetchWithVless.ts) — этот
      // клиент работает в Edge Runtime (см. корневой middleware.ts), где
      // недоступны Node-специфичные API undici (AbortSignal.any есть, но
      // проще держать Edge-путь совсем независимым). Свой короткий таймаут
      // вместо этого — см. edgeFetchWithTimeout выше.
      global: { fetch: edgeFetchWithTimeout },
      cookieOptions: { name: AUTH_COOKIE_NAME },
    },
  );

  // ВАЖНО: не вставлять код между createServerClient и getUser() (кроме
  // самого try/catch ниже — им пришлось обернуть, см. комментарий).
  //
  // Есть ли вообще кука сессии — используется НИЖЕ, а не сразу, потому что
  // getUser() при сетевом сбое (тот же затык VPS к Supabase, что чиним
  // VLESS-туннелем для Node.js-кода, см. fetchWithVless.ts — здесь,
  // в Edge Runtime, недоступен) НЕ бросает исключение, а тихо возвращает
  // {data:{user:null}, error: ...} — проверено вживую дважды: свежая,
  // только что подтверждённая валидной (напрямую через /auth/v1/user)
  // сессия каждый раз тут читалась как "не залогинен", try/catch ни разу
  // не сработал. Значит нельзя отличить "куки нет вообще" от "кука есть,
  // просто не смогли проверить" по одному user — сверяемся с самой кукой.
  const hasSessionCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'));

  let user: { id: string } | null = null;
  let verifyFailed = false;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (!user && result.error && hasSessionCookie) {
      // Кука есть, а getUser() её не подтвердил — не различаем здесь
      // "сеть не достучалась" от "Supabase reально отклонил": в обоих
      // случаях не наказываем принудительным логаутом. Настоящую
      // недействительную сессию (истёкшую/отозванную) всё равно отклонят
      // обычные серверные вызовы на самой странице (они уже туннелированы,
      // см. server.ts/service.ts) при реальном обращении к данным.
      console.error('[middleware] getUser() вернул error при наличии куки, пропускаем без строгой проверки:', result.error);
      verifyFailed = true;
    }
  } catch (err) {
    console.error('[middleware] getUser() упал, пропускаем без строгой проверки:', err);
    verifyFailed = true;
  }

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

  if (!user && !verifyFailed && !isPublicPage && !isApiRoute) {
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

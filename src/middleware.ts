import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { absoluteUrl } from '@/lib/site-url';

export async function middleware(request: NextRequest) {
  // Открываем последний использованный раздел: если заходят на главную,
  // а прошлый раз были в кино — переносим туда. Куку aw_mode пишет ModeSwitch.
  //
  // ВАЖНО: не редиректим фоновые prefetch-запросы (заголовок Next-Router-Prefetch —
  // их шлёт любая видимая на странице <Link href="/">, включая лого в шапке,
  // ещё ДО клика). Next.js кэширует такой редирект как «канонический URL» для
  // '/' и применяет его при реальном клике даже после смены куки — из-за этого
  // переключение обратно на «Аниме» зацикливалось на /cinema. Пропуская
  // prefetch без редиректа, кэш для '/' никогда не «отравляется» чужим адресом.
  //
  // ?mode=anime — отдельный обходной путь специально для ModeSwitch (см.
  // components/ModeSwitch.tsx): условие ниже уже пропускает любой '/' с
  // непустым search (см. `search === ''`), так что запрос на '/?mode=anime'
  // сюда и так не попадает — но у него ЕЩЁ и свой ключ клиентского Router
  // Cache, независимый от голого '/'. Поэтому даже если '/' когда-то
  // закэшировался как «редирект на /cinema», клик по «Аниме» на этот другой
  // адрес всё равно проходит middleware заново — можно использовать обычный
  // next/link (сохраняет Picture-in-Picture между разделами), а не полную
  // перезагрузку страницы.
  if (
    request.nextUrl.pathname === '/' &&
    request.nextUrl.search === '' &&
    !request.headers.get('Next-Router-Prefetch') &&
    request.cookies.get('aw_mode')?.value === 'cinema'
  ) {
    return NextResponse.redirect(absoluteUrl('/cinema', request.url));
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Матчим все пути, кроме статики и картинок:
     * - _next/static, _next/image
     * - favicon.ico и файлы с расширениями картинок
     * - manifest.json и sw.js (public/) — иначе анонимам, открывающим их
     *   напрямую (PWA-установка, регистрация service worker), редирект на
     *   /login отдаёт HTML вместо JSON/JS и ломает и то, и другое.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

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
  if (
    request.nextUrl.pathname === '/' &&
    request.nextUrl.search === '' &&
    !request.headers.get('Next-Router-Prefetch') &&
    request.cookies.get('aw_mode')?.value === 'cinema'
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/cinema';
    return NextResponse.redirect(url);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Матчим все пути, кроме статики и картинок:
     * - _next/static, _next/image
     * - favicon.ico и файлы с расширениями картинок
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

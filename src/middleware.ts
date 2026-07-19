import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // Открываем последний использованный раздел: если заходят на главную,
  // а прошлый раз были в кино — переносим туда. Куку aw_mode пишет ModeSwitch
  // (клик по вкладке ставит её до навигации, поэтому переключение назад
  // на «Аниме» не зацикливается).
  if (
    request.nextUrl.pathname === '/' &&
    request.nextUrl.search === '' &&
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

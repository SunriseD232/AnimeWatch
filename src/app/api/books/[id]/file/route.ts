import { NextResponse, type NextRequest } from 'next/server';
import { fetchBookFile } from '@/lib/books';
import { getCachedUser } from '@/lib/supabase/server';
import type { BookFormat } from '@/lib/bookShared';

/**
 * GET /api/books/[id]/file?format=epub|fb2 — файл книги через наш сервер.
 *
 * Зачем свой роут, а не прямая ссылка из OPDS:
 *   • Флибуста отдаёт книгу по http, а сайт живёт на https — браузер заблокировал
 *     бы и чтение, и скачивание (mixed content).
 *   • Адрес источника наружу не уходит: браузер видит только наш домен.
 *   • Ответ можно пометить правильным Content-Type. Прокси /api/proxy/raw
 *     отдаёт как есть, а epub.js надёжнее открывает файл, когда сервер честно
 *     сказал `application/epub+zip`.
 *
 * Формат по умолчанию — EPUB. FB2 здесь тоже поддержан: его забирает
 * серверный FB2-читатель (/books/read/[id]/fb2), хотя обычно он ходит в
 * fetchBookFile напрямую, без лишнего HTTP-круга через свой же сервер.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Файл 0,3–1,5 МБ; с диска — мгновенно. С Флибусты — до ~60 сек в худшем
// случае (15 сек на запрос, два прохода по двум зеркалам) плюс передача.
export const maxDuration = 90;

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  // Только для вошедших. Middleware пропускает /api/* без сессии (см.
  // lib/supabase/middleware.ts), а id здесь любой — без этой проверки роут
  // был бы открытой качалкой Флибусты через наш сервер и VLESS-туннель.
  // epub.js запрашивает файл с того же домена, кука сессии уходит сама.
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const requested = request.nextUrl.searchParams.get('format');
  const format: BookFormat = requested === 'fb2' ? 'fb2' : 'epub';

  let file: Awaited<ReturnType<typeof fetchBookFile>> = null;
  try {
    file = await fetchBookFile(id, format);
  } catch (err) {
    console.error(
      `[books] файл ${id}.${format} не скачался:`,
      err instanceof Error ? err.message : err,
    );
  }

  if (!file) {
    // 502, а не 404: книга, скорее всего, есть, но зеркало не ответило.
    // Читатель по этому коду покажет «попробуйте FB2/позже», а не «нет книги».
    return NextResponse.json({ error: 'source unavailable' }, { status: 502 });
  }

  // FB2 у Флибусты приходит zip-архивом, но после зеркал/прокси иногда
  // разворачивается в голый XML (см. fetchBookFile). Тип ставим по сигнатуре:
  // иначе браузер предложил бы сохранить XML как архив.
  const head = new Uint8Array(file.body, 0, Math.min(4, file.body.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;

  return new Response(file.body, {
    headers: {
      'Content-Type':
        format === 'epub' || isZip ? 'application/epub+zip' : 'application/xml',
      // inline: браузер не предлагает «сохранить», epub.js забирает файл сам.
      'Content-Disposition': `inline; filename="${id}.${format}"`,
      // Час на клиенте и в CDN: книгу читают подряд, повторные загрузки при
      // перелистывании нам не нужны. private — ответ зависит от подписи/сессии.
      'Cache-Control': 'private, max-age=3600',
      // Не даём браузеру угадывать тип: EPUB — это zip, и без заголовка он
      // иногда решает, что это архив для скачивания.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

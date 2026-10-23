import Link from 'next/link';
import { notFound } from 'next/navigation';
import Fb2Reader from '@/components/books/Fb2Reader';
import { fetchBookFile, getBookById } from '@/lib/books';
import { parseFb2Zip } from '@/lib/fb2';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Скачивание fb2+zip (20 сек таймаут) + распаковка и разбор XML на сервере.
export const maxDuration = 60;

/**
 * Запасной FB2-читатель: /books/read/[id]/fb2.
 *
 * Нужен, когда EPUB не открылся (Флибуста не сконвертировала книгу, битый
 * архив, epub.js не разобрал разметку). Здесь файл качается и разбирается на
 * сервере (lib/fb2.ts), а браузер получает готовый HTML — читается даже то,
 * что epub.js не берёт.
 *
 * Позиция — доля прокрутки (locator.scrollPercent) или progress_percent,
 * если книга начата в EPUB-читателе: тогда точность до страницы теряется, но
 * место остаётся тем же.
 */
export default async function BookFb2Page({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const supabase = createClient();
  const [book, {
    data: { user },
  }] = await Promise.all([getBookById(id), getCachedUser()]);
  if (!book) notFound();

  let progress: WatchProgress | null = null;
  if (user) {
    const { data } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('content_type', 'book')
      .eq('shikimori_id', id)
      .maybeSingle();
    progress = (data as WatchProgress | null) ?? null;
  }

  const locator = progress?.locator ?? null;
  const savedScroll =
    locator && typeof locator === 'object' && typeof locator.scrollPercent === 'number'
      ? locator.scrollPercent
      : null;
  const initialPercent = Math.max(
    0,
    Math.min(1, savedScroll ?? progress?.progress_percent ?? 0),
  );

  const file = await fetchBookFile(id, 'fb2');
  const parsed = file ? parseFb2Zip(file.body) : null;

  if (!parsed) {
    return (
      <div className="flex flex-col gap-4">
        <Link href={`/books/${id}`} className="w-fit text-sm text-gray-400 hover:text-white">
          ← К книге
        </Link>
        <div className="flex max-w-xl flex-col gap-3 rounded-2xl bg-bg-card p-6 ring-1 ring-inset ring-white/5">
          <h1 className="text-lg font-semibold">{book.title}</h1>
          <p className="text-sm text-gray-400">
            Не удалось открыть FB2: источник не отдал файл или архив повреждён. Попробуйте
            EPUB-версию — она обычно работает.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/books/read/${id}`}
              prefetch={false}
              className="press rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg"
            >
              Открыть EPUB
            </Link>
            {book.sourceUrl ? (
              <a
                href={book.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="press rounded-full bg-bg-soft px-4 py-2 text-sm ring-1 ring-white/10"
              >
                Страница на Флибусте
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Fb2Reader
      key={book.id}
      id={book.id}
      title={book.title || parsed.title}
      coverUrl={book.coverUrl}
      source="flibusta"
      html={parsed.html}
      annotation={parsed.annotation}
      chapters={parsed.chapters}
      initialPercent={initialPercent}
    />
  );
}

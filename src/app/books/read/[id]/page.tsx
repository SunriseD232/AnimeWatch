import { notFound } from 'next/navigation';
import BookReader from '@/components/books/BookReader';
import SyncBanner from '@/components/books/SyncBanner';
import { getBookOffer, parseSyncFraction } from '@/lib/syncOffers';
import { getBookById } from '@/lib/books';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Читатель EPUB: /books/read/[id].
 *
 * Позиция восстанавливается из watch_progress по CFI (locator.cfi) — это
 * точное место в книге, не зависящее от размера окна и шрифта. Если CFI нет
 * (первое открытие, книга пришла из FB2-читателя, где хранится процент), в
 * epub.js уходит процент — он сам найдёт ближайшую страницу.
 *
 * Файл не читаем здесь, на сервере: epub.js забирает его сам из
 * /api/books/[id]/file. Так книга не проходит через память Node дважды, а
 * браузер получает её потоком.
 *
 * ?from=0.342 — открыть с доли текста: так плашка синхронизации с
 * аудиокнигой (lib/syncOffers.ts) переносит место из записи в книгу.
 */
export default async function BookReaderPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string };
}) {
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
  const initialCfi =
    locator && typeof locator === 'object' && typeof locator.cfi === 'string'
      ? locator.cfi
      : null;
  const initialPercent =
    progress?.progress_percent != null
      ? Math.max(0, Math.min(1, progress.progress_percent))
      : null;

  // Открытие с места из аудиокниги: процент вместо CFI — epub.js сам найдёт
  // страницу по карте мест (она строится по объёму текста, как и доля).
  const from = parseSyncFraction(searchParams.from);
  const offer = user && from == null ? await getBookOffer(id, progress) : null;

  const reader = (
    <BookReader
      // Ключ: при переходе на другую книгу компонент пересоздаётся целиком,
      // и epub.js не пытается переиспользовать старый движок.
      key={book.id}
      id={book.id}
      title={book.title}
      coverUrl={book.coverUrl}
      source="flibusta"
      sourceUrl={book.sourceUrl}
      fileUrl={`/api/books/${book.id}/file?format=epub`}
      fb2Href={`/books/read/${book.id}/fb2`}
      initialCfi={from != null ? null : initialCfi}
      initialPercent={from ?? initialPercent}
    />
  );

  if (!offer) return reader;
  return (
    <div className="flex flex-col gap-3">
      <SyncBanner
        text={offer.text}
        baseHref={`/books/read/${id}`}
        fraction={offer.fraction}
        audiobookId={offer.audiobookId}
        chapterIndex={offer.chapterIndex}
        position={offer.position}
      />
      {reader}
    </div>
  );
}

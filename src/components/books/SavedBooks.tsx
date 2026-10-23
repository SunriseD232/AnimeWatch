import Link from 'next/link';
import PosterImage from '@/components/PosterImage';
import { listSavedBooks } from '@/lib/bookStorage';
import { MAX_SAVED_BOOKS } from '@/lib/bookShared';
import { getCachedUser } from '@/lib/supabase/server';

/**
 * «Сохранено на сервере» на странице книг (миграция 0058).
 *
 * У каждой книги — срок «хранится до»: крон убирает книгу, которую не
 * открывали 90 дней (дочитанную — 30). Срок показан заранее, чтобы удаление
 * не было сюрпризом; читать — значит продлевать.
 *
 * Название и обложка — из самой строки сохранения, а не из book_index: книга
 * могла выпасть из витрины, а сохранённое должно показываться.
 */
export default async function SavedBooks() {
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) return null;

  const books = await listSavedBooks(user.id);
  if (books.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Сохранено на сервере</h2>
        <span className="text-xs text-gray-400">
          {books.length} из {MAX_SAVED_BOOKS}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {books.map((book) => {
          const poster = book.coverUrl
            ? `${book.coverUrl}${book.coverUrl.includes('?') ? '&' : '?'}w=240`
            : null;
          const until = new Date(book.expiresAt).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
          });
          // Меньше недели до удаления — выделяем, чтобы человек успел открыть.
          const soon = new Date(book.expiresAt).getTime() - Date.now() < 7 * 86_400_000;
          return (
            <Link
              key={book.bookId}
              href={`/books/${book.bookId}`}
              prefetch={false}
              className="press flex min-w-0 items-center gap-3 rounded-2xl bg-bg-card p-3 ring-1 ring-inset ring-white/5 transition hover:ring-accent/60"
            >
              <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
                <PosterImage
                  sources={[poster]}
                  alt=""
                  className="h-full w-full object-cover"
                  placeholderClassName="grid h-full w-full place-items-center text-[10px] text-gray-500"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{book.title}</p>
                {book.author ? (
                  <p className="truncate text-xs text-gray-400">{book.author}</p>
                ) : null}
                <p className={soon ? 'text-xs text-amber-300' : 'text-xs text-gray-500'}>
                  {book.finished ? 'Дочитана · ' : ''}хранится до {until}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

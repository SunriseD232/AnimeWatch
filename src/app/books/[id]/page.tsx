import Link from 'next/link';
import ListButton from '@/components/ListButton';
import { getListEntry } from '@/lib/listEntry';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import PosterImage from '@/components/PosterImage';
import { BOOK_FORMAT_LABEL } from '@/lib/bookShared';
import { getBookById } from '@/lib/books';
import { listSavedBooks } from '@/lib/bookStorage';
import SaveBookButton from '@/components/books/SaveBookButton';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { title: 'Книга — MediaWatch' };
  const book = await getBookById(id);
  if (!book) return { title: 'Книга — MediaWatch' };
  return {
    title: `${book.title} — ${book.author} — MediaWatch`,
    description: book.annotation?.slice(0, 200) ?? undefined,
  };
}

/**
 * Карточка книги.
 *
 * Метаданные берутся ТОЛЬКО из нашего book_index (getBookById): у Флибусты
 * нет OPDS-эндпоинта «книга по id» — `/opds/book/{id}` отдаёт корневой
 * каталог. Поэтому книга попадает сюда, если её нашёл крон или живой поиск
 * (rememberBooks, см. lib/books.ts).
 *
 * Отсюда же два входа в читатель: EPUB (основной) и FB2 (запасной). Оба —
 * внутри сайта; внешняя ссылка только на страницу-источник, для атрибуции.
 */
export default async function BookPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const supabase = createClient();
  const [book, {
    data: { user },
  }] = await Promise.all([getBookById(id), getCachedUser()]);
  if (!book) notFound();

  let progress: WatchProgress | null = null;
  // Сохранена ли книга на сервере и сколько мест занято (миграция 0058).
  let savedExpiresAt: string | null = null;
  let isSaved = false;
  let savedCount = 0;
  let listEntry: Awaited<ReturnType<typeof getListEntry>> = null;
  if (user) {
    const [{ data }, allSaved, entry] = await Promise.all([
      supabase
        .from('watch_progress')
        .select('*')
        .eq('content_type', 'book')
        .eq('shikimori_id', id)
        .maybeSingle(),
      listSavedBooks(user.id),
      getListEntry('book', id),
    ]);
    listEntry = entry;
    progress = (data as WatchProgress | null) ?? null;
    const savedBook = allSaved.find((entry) => entry.bookId === id) ?? null;
    isSaved = savedBook != null;
    savedExpiresAt = savedBook?.expiresAt ?? null;
    savedCount = allSaved.length;
  }

  const percent =
    progress?.progress_percent != null
      ? Math.round(Math.max(0, Math.min(1, progress.progress_percent)) * 100)
      : null;

  // На карточке обложка крупнее, чем в сетке, — просим у прокси ширину 480.
  const cover = book.coverUrl
    ? `${book.coverUrl}${book.coverUrl.includes('?') ? '&' : '?'}w=480`
    : null;

  const meta = [
    book.author,
    book.year ? `${book.year}` : null,
    book.language ? book.language.toUpperCase() : null,
    book.sizeBytes ? `${Math.max(1, Math.round(book.sizeBytes / 1024))} КБ` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/books" className="w-fit text-sm text-gray-400 transition hover:text-white">
        ← Все книги
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="mx-auto aspect-[2/3] w-44 shrink-0 overflow-hidden rounded-2xl bg-bg-soft ring-1 ring-inset ring-white/5 sm:mx-0 sm:w-52">
          {cover ? (
            <PosterImage
              sources={[cover]}
              alt={book.title}
              priority
              className="h-full w-full object-cover"
              placeholderClassName="grid h-full w-full place-items-center bg-gradient-to-br from-bg-soft to-bg-card p-4 text-center text-sm text-gray-400"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-bg-soft to-bg-card">
              <span className="text-5xl font-bold text-white/15">
                {book.title.trim().charAt(0).toUpperCase() || '?'}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold leading-tight">{book.title}</h1>
            <p className="text-sm text-gray-300">{book.author}</p>
            <p className="text-sm text-gray-400">{meta.join(' · ')}</p>
          </div>

          {book.genres.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {book.genres.slice(0, 8).map((genre) => (
                <Link
                  key={genre}
                  href={`/books?genre=${encodeURIComponent(genre)}`}
                  className="press rounded-full bg-bg-soft px-2.5 py-1 text-xs text-gray-300 ring-1 ring-white/10 transition hover:text-white"
                >
                  {genre}
                </Link>
              ))}
            </div>
          ) : null}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Link
              href={`/books/read/${book.id}`}
              prefetch={false}
              className="press rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg"
            >
              {percent != null && percent > 0
                ? `Продолжить · ${percent}%`
                : 'Читать'}
            </Link>

            {book.formats.includes('fb2') ? (
              <Link
                href={`/books/read/${book.id}/fb2`}
                prefetch={false}
                className="press rounded-full bg-bg-soft px-4 py-2.5 text-sm ring-1 ring-white/10 hover:text-white"
              >
                Читать FB2
              </Link>
            ) : null}

            <ListButton
              shikimoriId={book.id}
              contentType="book"
              animeTitle={book.title}
              posterUrl={book.coverUrl}
              initialStatus={listEntry?.status ?? null}
              initialMuted={listEntry?.muted ?? false}
              isAuthed={!!user}
            />

            {book.sourceUrl ? (
              <a
                href={book.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="press rounded-full bg-bg-soft px-4 py-2.5 text-sm ring-1 ring-white/10 hover:text-white"
              >
                Источник: Флибуста
              </a>
            ) : null}
          </div>

          {user ? (
            <SaveBookButton
              bookId={book.id}
              saved={isSaved}
              expiresAt={savedExpiresAt}
              savedCount={savedCount}
            />
          ) : null}

          <p className="text-xs text-gray-500">
            Форматы: {book.formats.map((f) => BOOK_FORMAT_LABEL[f]).join(', ') || 'EPUB'}.
            Чтение — прямо на сайте, место сохраняется автоматически.
          </p>

          {!user ? (
            <p className="text-xs text-gray-500">
              Войдите, чтобы позиция чтения сохранялась между устройствами.
            </p>
          ) : null}
        </div>
      </div>

      {book.annotation ? (
        <section className="flex max-w-3xl flex-col gap-2">
          <h2 className="text-lg font-semibold">Описание</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300">
            {book.annotation}
          </p>
        </section>
      ) : null}
    </div>
  );
}

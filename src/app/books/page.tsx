import { Suspense } from 'react';
import Link from 'next/link';
import Pagination from '@/components/Pagination';
import { CardGridSkeleton } from '@/components/Skeletons';
import BookCard from '@/components/books/BookCard';
import BookContinue from '@/components/books/BookContinue';
import SavedBooks from '@/components/books/SavedBooks';
import BookSearchBar from '@/components/books/BookSearchBar';
import {
  getBookCatalog,
  getBookGenres,
  rememberBooks,
  searchBooks,
} from '@/lib/books';
import type { BookSummary } from '@/lib/bookShared';

export const metadata = { title: 'Книги — MediaWatch' };

// Живой поиск — один запрос к OPDS Флибусты (таймаут 20 сек, см.
// lib/books.ts). Каталог из индекса — один SQL-запрос.
export const maxDuration = 30;

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

/**
 * Каталог книг.
 *
 * Два источника, как у подкастов. Основной — свой индекс (book_index,
 * миграция 0054): он даёт витрину без запроса, фильтр по жанру и поиск по
 * подстроке триграммами. Но у Флибусты в каталоге миллионы книг, а в витрине
 * — тысячи, поэтому при поиске мы ДОПОЛНИТЕЛЬНО спрашиваем OPDS живьём и
 * показываем объединение. Всё, что нашлось живьём, «докладывается» в
 * book_index (rememberBooks) — иначе карточка по id не открылась бы: у
 * Флибусты нет эндпоинта «книга по id».
 */
export default async function BooksPage({
  searchParams,
}: {
  searchParams: { q?: string; genre?: string; page?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  const genre = (searchParams.genre ?? '').trim();
  const pageParam = Number(searchParams.page);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const genres = await getBookGenres();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">Книги</h1>
        <p className="text-sm text-gray-400">
          Художественная литература и нон-фикшн. Читать можно прямо на сайте — в читателе с
          оглавлением, темами и сохранением места.
        </p>
      </div>

      <BookSearchBar initialQuery={query} initialGenre={genre} />

      {genres.length > 0 ? (
        <GenreChips genres={genres.slice(0, 16)} active={genre} />
      ) : null}

      <Suspense fallback={null}>
        <BookContinue />
      </Suspense>

      <Suspense fallback={null}>
        <SavedBooks />
      </Suspense>

      <Suspense key={`${query}:${genre}:${page}`} fallback={<CardGridSkeleton count={12} />}>
        <BookResults query={query} genre={genre} page={page} />
      </Suspense>
    </div>
  );
}

async function BookResults({
  query,
  genre,
  page,
}: {
  query: string;
  genre: string;
  page: number;
}) {
  // Основной путь: запрос есть — живой OPDS-поиск (+ индекс на первой
  // странице, чтобы подстрочные совпадения из витрины не терялись).
  // Запроса нет — витрина индекса с фильтром по жанру.
  const [live, indexed] = query
    ? await Promise.all([
        searchBooks(query, page),
        page === 1
          ? getBookCatalog({ query, page: 1, pageSize: PAGE_SIZE })
          : Promise.resolve({ items: [], total: 0 }),
      ])
    : [
        { items: [] as BookSummary[], hasNext: false },
        await getBookCatalog({ genre, page, pageSize: PAGE_SIZE }),
      ];

  // Всё найденное живьём — в индекс, чтобы карточка открылась по id.
  if (live.items.length > 0) await rememberBooks(live.items);

  const items = mergeBooks(indexed.items, live.items);

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
        {query
          ? 'По этому запросу ничего не нашлось. Попробуйте другое название или фамилию автора.'
          : 'Каталог книг ещё наполняется. Введите название в поиске — живой поиск по Флибусте работает уже сейчас.'}
      </p>
    );
  }

  const hasMore = query ? live.hasNext : indexed.total > page * PAGE_SIZE;

  return (
    <div className="flex flex-col gap-6">
      <div className="catalog-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((book, i) => (
          <BookCard key={book.id} book={book} priority={i < 6} />
        ))}
      </div>

      <Pagination
        page={page}
        prevHref={page > 1 ? pageHref({ query, genre, page: page - 1 }) : null}
        nextHref={hasMore ? pageHref({ query, genre, page: page + 1 }) : null}
      />
    </div>
  );
}

/** Слияние витрины и живой выдачи: индекс первым (он уже отфильтрован), живое — в конец. */
function mergeBooks(indexed: BookSummary[], live: BookSummary[]): BookSummary[] {
  if (live.length === 0) return indexed;
  const seen = new Set(indexed.map((b) => b.id));
  return [...indexed, ...live.filter((b) => !seen.has(b.id))];
}

function pageHref({
  query,
  genre,
  page,
}: {
  query: string;
  genre: string;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (genre) params.set('genre', genre);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/books?${qs}` : '/books';
}

/** Жанры витрины — горизонтальная лента чипов. */
function GenreChips({ genres, active }: { genres: string[]; active: string }) {
  return (
    <div className="-mx-1 flex flex-wrap gap-2">
      <Link
        href="/books"
        aria-current={!active ? 'page' : undefined}
        className={[
          'press rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition',
          active
            ? 'bg-bg-card text-gray-200 ring-white/10 hover:text-white'
            : 'bg-accent/15 text-accent-text ring-accent/30',
        ].join(' ')}
      >
        Все
      </Link>
      {genres.map((genre) => (
        <Link
          key={genre}
          href={`/books?genre=${encodeURIComponent(genre)}`}
          aria-current={genre === active ? 'page' : undefined}
          className={[
            'press rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition',
            genre === active
              ? 'bg-accent/15 text-accent-text ring-accent/30'
              : 'bg-bg-card text-gray-300 ring-white/10 hover:text-white',
          ].join(' ')}
        >
          {genre}
        </Link>
      ))}
    </div>
  );
}

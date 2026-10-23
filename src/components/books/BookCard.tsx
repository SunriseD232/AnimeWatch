'use client';

import Link from 'next/link';
import { useState } from 'react';
import PosterImage from '@/components/PosterImage';
import { BOOK_FORMAT_LABEL, type BookSummary } from '@/lib/bookShared';

/**
 * Карточка книги. По устройству — сосед PodcastCard: та же плитка, тот же
 * «лифт» при наведении, то же раскрытие длинного названия.
 *
 * Отличия:
 *   • Обложка 2:3, как у аниме/кино, а не квадрат: книжные обложки
 *     вертикальные, и в квадратном боксе они висели бы с полями.
 *   • Нет обложки — рисуем градиентную заглушку с первой буквой названия, а
 *     не «нет постера»: у Флибусты обложка есть далеко не у всех книг, и
 *     серые прямоугольники сделали бы сетку однообразной.
 *   • Размер обложки ограничен `?w=320`: оригиналы — PNG по 300–700 КБ.
 */
export default function BookCard({
  book,
  priority = false,
}: {
  book: BookSummary;
  priority?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Подписанная ссылка уже содержит query (?u=…&s=…), поэтому размер
  // дописываем через «&». Для неподписанной (локально без секрета) — через «?».
  const cover = book.coverUrl
    ? `${book.coverUrl}${book.coverUrl.includes('?') ? '&' : '?'}w=320`
    : null;

  const meta = [book.author, book.year].filter(Boolean).join(' · ');
  const firstLetter = book.title.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5 hover:ring-accent/60">
      <Link href={`/books/${book.id}`} prefetch={false} className="flex flex-1 flex-col">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
          {cover ? (
            <PosterImage
              sources={[cover]}
              alt={book.title}
              priority={priority}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              placeholderClassName="grid h-full w-full place-items-center bg-gradient-to-br from-bg-soft to-bg-card text-4xl font-bold text-white/15"
            />
          ) : (
            <div
              aria-hidden="true"
              className="grid h-full w-full place-items-center bg-gradient-to-br from-bg-soft to-bg-card"
            >
              <span className="text-4xl font-bold text-white/15">{firstLetter}</span>
            </div>
          )}

          {/* Формат — мелким бейджем поверх обложки: человеку важно знать до
              клика, откроется ли книга в читателе. */}
          {book.formats.length > 0 ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-200">
              {BOOK_FORMAT_LABEL[book.formats.includes('epub') ? 'epub' : 'fb2']}
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
            className={[
              'text-sm font-semibold leading-snug',
              expanded ? 'line-clamp-none' : 'line-clamp-2',
            ].join(' ')}
          >
            {book.title}
          </h3>
          <p className="mt-auto line-clamp-1 text-xs text-gray-400">{meta}</p>
          {book.genres.length > 0 ? (
            <p className="line-clamp-1 text-xs text-accent-text">{book.genres[0]}</p>
          ) : null}
        </div>
      </Link>
    </div>
  );
}

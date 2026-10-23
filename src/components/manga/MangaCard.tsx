'use client';

import Link from 'next/link';
import { useState } from 'react';
import PosterImage from '@/components/PosterImage';
import {
  mangaTitleHref,
  type MangaSummary,
} from '@/lib/mangaShared';

/**
 * Карточка манги. По устройству — сосед RanobeCard: та же вертикальная
 * обложка 2:3, тот же «лифт» при наведении и раскрытие длинного названия.
 *
 * Отличия:
 *   • поверх обложки — рейтинг и тип (Манга/Манхва/Маньхуа): у Remanga
 *     рейтинг часто важнее года;
 *   • нет обложки — градиентная заглушка с первой буквой: у источника
 *     картинка есть почти всегда, но прокси может не ответить.
 */
export default function MangaCard({
  manga,
  priority = false,
}: {
  manga: MangaSummary;
  priority?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Подписанная ссылка уже содержит query (?u=…&s=…), поэтому размер
  // дописываем через «&». Для неподписанной (локально без секрета) — через «?».
  const cover = manga.coverUrl
    ? `${manga.coverUrl}${manga.coverUrl.includes('?') ? '&' : '?'}w=320`
    : null;

  const meta = [
    manga.kind,
    manga.year ? String(manga.year) : null,
    manga.chaptersCount ? `${manga.chaptersCount} гл.` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const firstLetter = manga.title.trim().charAt(0).toUpperCase() || '?';
  const rating =
    manga.rating != null && manga.rating > 0 ? manga.rating.toFixed(1) : null;

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5 hover:ring-accent/60">
      <Link
        href={mangaTitleHref(manga.dir)}
        prefetch={false}
        className="flex flex-1 flex-col"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
          {cover ? (
            <PosterImage
              sources={[cover]}
              alt={manga.title}
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

          {rating ? (
            <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300">
              ★ {rating}
            </span>
          ) : null}

          {manga.kind ? (
            <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-gray-200">
              {manga.kind}
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
            {manga.title}
          </h3>
          {manga.originalTitle ? (
            <p className="line-clamp-1 text-xs text-gray-500">{manga.originalTitle}</p>
          ) : null}
          <p className="mt-auto line-clamp-1 text-xs text-gray-400">
            {meta || 'Манга'}
          </p>
        </div>
      </Link>
    </div>
  );
}

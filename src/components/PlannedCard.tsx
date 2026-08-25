'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import ExpandTitleButton from '@/components/ExpandTitleButton';
import { fixPosterUrl } from '@/lib/format';

/** Карточка блока «Вы хотели посмотреть» (см. HomePage/CinemaPage) — тот же
 *  визуальный стиль, что у AnimeCard/CinemaCard в каталоге, но данные не из
 *  полного каталога/Shikimori, а прямо из user_list (там уже есть
 *  денормализованные title/poster — как и в ContinueCard, не нужен ещё один
 *  внешний запрос только чтобы отрисовать постер). В отличие от
 *  ContinueCard — ведёт на КАРТОЧКУ тайтла, не сразу в плеер: тайтл из
 *  «Хотел посмотреть» ещё не начат, смотреть тут нечего продолжать. */
export default function PlannedCard({
  contentType,
  shikimoriId,
  title,
  posterUrl,
}: {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  title: string;
  posterUrl: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const href = contentType === 'cinema' ? `/cinema/${shikimoriId}` : `/anime/${shikimoriId}`;

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 hover:ring-accent/60">
      <Link href={href} className="flex flex-1 flex-col">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
          {posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fixPosterUrl(posterUrl)!}
              alt={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-400">
              нет постера
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 p-2.5">
          <h3
            ref={titleRef}
            className={[
              'text-sm font-medium leading-snug text-gray-100',
              expanded ? '' : 'line-clamp-2',
            ].join(' ')}
          >
            {title}
          </h3>
        </div>
      </Link>
      <ExpandTitleButton
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        titleRef={titleRef}
      />
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import { regionLabel, type PodcastSummary } from '@/lib/podcastShared';

/**
 * Карточка подкаста. По устройству — сосед AnimeCard/CinemaCard: та же
 * «лифт»-плитка, то же поведение заголовка, тот же PosterImage с запасными
 * ссылками (обложки приходят с mzstatic.com, а он тоже иногда отдаёт 404).
 *
 * Отличий два и оба принципиальные.
 *
 * Форма обложки — квадрат, а не 2:3. У подкастов обложки квадратные по
 * стандарту, и в вертикальном боксе карточка либо обрезала бы бока, либо
 * висела бы с полями. Квадрат держит сетку ровной без object-fit-костылей.
 *
 * Прогресса в карточке нет. У аниме/кино бейдж «серия N» осмысленен — серия
 * короткая, и «продолжить с 7-й» понятно. Эпизод подкаста — это час-два, и
 * человек почти всегда слушает заново или начинает с последнего. Поэтому
 * карточка ведёт на страницу подкаста, а не в плеер.
 */
export default function PodcastCard({
  podcast,
  priority = false,
}: {
  podcast: PodcastSummary;
  priority?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const meta = [podcast.author, regionLabel(podcast.country)].filter(Boolean).join(' · ');

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5 hover:ring-accent/60">
      {/* prefetch={false}: страница подкаста тянет RSS-фид (у крупного шоу
          это несколько мегабайт), и автопрефетч заранее грузил бы её для
          каждой карточки в сетке. Спешить тут некуда — переход и так быстрый
          за счёт кэша фида, см. lib/podcasts.ts. */}
      <Link href={`/podcasts/${podcast.id}`} prefetch={false} className="flex flex-1 flex-col">
        <div className="relative aspect-square w-full overflow-hidden bg-bg-soft">
          <PosterImage
            sources={[podcast.artworkUrl]}
            alt={podcast.title}
            priority={priority}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        </div>
        {/* Ссылок несколько, а не одна: <h3> внутри <Link> — это ссылка
            целиком; onMouseEnter/onMouseLeave на заголовке расширяют её
            строки, чтобы длинное название не рвалось многоточием (тот же
            приём, что в AnimeCard). */}
        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3
            ref={titleRef}
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
            className={[
              'text-sm font-semibold leading-snug',
              expanded ? 'line-clamp-none' : 'line-clamp-2',
            ].join(' ')}
          >
            {podcast.title}
          </h3>
          <p className="mt-auto line-clamp-1 text-xs text-gray-400">{meta}</p>
          {podcast.genre ? (
            <p className="line-clamp-1 text-xs text-accent-text">{podcast.genre}</p>
          ) : null}
        </div>
      </Link>
    </div>
  );
}

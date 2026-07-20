'use client';

import Link from 'next/link';
import { useState } from 'react';
import { imageUrl, type ShikimoriAnimeShort } from '@/lib/shikimori';
import ExpandTitleButton from '@/components/ExpandTitleButton';

const KIND_LABELS: Record<string, string> = {
  tv: 'ТВ',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спешл',
  music: 'Клип',
};

export default function AnimeCard({
  anime,
}: {
  anime: ShikimoriAnimeShort;
}) {
  const [expanded, setExpanded] = useState(false);
  const poster = imageUrl(anime.image?.original);
  const title = anime.russian || anime.name;
  const year = anime.aired_on ? anime.aired_on.slice(0, 4) : null;
  const kind = anime.kind ? KIND_LABELS[anime.kind] ?? anime.kind : null;
  // Анонс — тайтл ещё не вышел нигде, смотреть нечего (см. страницу тайтла).
  const isAnons = anime.status === 'anons';

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 hover:ring-accent/60">
      <Link href={`/anime/${anime.id}`} className="flex flex-1 flex-col">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
          {poster ? (
            // Обычный <img> с no-referrer: Shikimori режет хотлинк по Referer,
            // а прокси next/image с серверных IP рейт-лимитится — картинки
            // пропадали. Прямая загрузка из браузера стабильна.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-600">
              нет постера
            </div>
          )}
          {anime.score && Number(anime.score) > 0 && (
            <span className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-amber-300">
              ★ {anime.score}
            </span>
          )}
          {isAnons && (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-accent/90 px-1.5 py-0.5 text-xs font-medium text-white">
              Анонс
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 p-2.5">
          <h3
            className={[
              'text-sm font-medium leading-snug text-gray-100',
              expanded ? '' : 'line-clamp-2',
            ].join(' ')}
          >
            {title}
          </h3>
          <p className="text-xs text-gray-500">
            {[kind, year].filter(Boolean).join(' · ')}
          </p>
        </div>
      </Link>
      <ExpandTitleButton
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
    </div>
  );
}

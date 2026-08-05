'use client';

import Link from 'next/link';
import type { WatchedEpisode } from '@/lib/types';
import { fixPosterUrl } from '@/lib/format';

/** Формат даты для истории — «5 авг, 14:32». */
function formatWatchedAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryView({ items }: { items: WatchedEpisode[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-bg-card px-6 py-10 text-center">
        <span className="text-3xl" aria-hidden="true">
          🕘
        </span>
        <p className="text-sm text-gray-400">
          История просмотра пока пуста — досмотренные серии появятся здесь.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((ep) => (
        <Link
          key={ep.id}
          href={`/${ep.content_type === 'cinema' ? 'cinema' : 'anime'}/${ep.shikimori_id}`}
          className="card-lift flex items-center gap-3 rounded-xl bg-bg-card p-2.5 ring-1 ring-white/5 hover:ring-accent/60"
        >
          <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
            {ep.poster_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fixPosterUrl(ep.poster_url)!}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-gray-100">
              {ep.anime_title ?? 'Без названия'}
            </span>
            <span className="text-xs text-gray-400">
              {ep.season > 1 ? `Сезон ${ep.season}, ` : ''}
              Серия {ep.episode}
            </span>
          </div>
          <span className="shrink-0 text-xs text-gray-500">
            {formatWatchedAt(ep.watched_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}

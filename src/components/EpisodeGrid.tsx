import Link from 'next/link';

interface Props {
  shikimoriId: number;
  total: number;
  currentEpisode: number | null;
  /** База ссылки просмотра: /watch (аниме) или /cinema/watch (кино). */
  basePath?: string;
}

/**
 * Сетка кнопок серий. Серии ≤ текущей подсвечены как просмотренные,
 * текущая — акцентом.
 */
export default function EpisodeGrid({
  shikimoriId,
  total,
  currentEpisode,
  basePath = '/watch',
}: Props) {
  const episodes = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
      {episodes.map((ep) => {
        const isCurrent = currentEpisode === ep;
        const isWatched =
          currentEpisode !== null && ep < currentEpisode;
        return (
          <Link
            key={ep}
            href={`${basePath}/${shikimoriId}/${ep}`}
            className={[
              'grid h-11 place-items-center rounded-lg text-sm font-medium ring-1 transition',
              isCurrent
                ? 'bg-accent text-white ring-accent'
                : isWatched
                  ? 'bg-accent/15 text-accent ring-accent/30'
                  : 'bg-bg-card text-gray-300 ring-white/5 hover:bg-bg-soft hover:text-white',
            ].join(' ')}
            aria-current={isCurrent ? 'true' : undefined}
          >
            {ep}
          </Link>
        );
      })}
    </div>
  );
}

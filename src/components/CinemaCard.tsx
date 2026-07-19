import Link from 'next/link';
import type { CinemaShort } from '@/lib/videoseed-catalog';

/**
 * Карточка фильма/сериала. Постеры приходят с хоста Videoseed
 * (api.videoseed.tv), поэтому используем обычный <img> без next/image —
 * так не нужен allowlist доменов и ничего не ломается на неизвестном хосте.
 */
export default function CinemaCard({ item }: { item: CinemaShort }) {
  return (
    <Link
      href={`/cinema/${item.id}`}
      className="card-lift group flex flex-col overflow-hidden rounded-xl bg-bg-card ring-1 ring-white/5 hover:ring-accent/60"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
        {item.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.poster}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-gray-600">
            нет постера
          </div>
        )}
        {item.rating !== null && (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium text-amber-300">
            ★ {item.rating.toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-gray-100">
          {item.title}
        </h3>
        <p className="text-xs text-gray-500">
          {[item.kind, item.year].filter(Boolean).join(' · ')}
        </p>
      </div>
    </Link>
  );
}

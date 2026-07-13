import Image from 'next/image';
import Link from 'next/link';
import type { WatchProgress } from '@/lib/types';
import { formatTime, watchPercent } from '@/lib/format';

/** Карточка блока «Продолжить просмотр». */
export default function ContinueCard({
  progress,
}: {
  progress: WatchProgress;
}) {
  const percent = watchPercent(
    progress.position_seconds,
    progress.duration_seconds,
  );

  return (
    <Link
      href={`/watch/${progress.shikimori_id}/${progress.episode}`}
      className="group flex flex-col overflow-hidden rounded-xl bg-bg-card ring-1 ring-white/5 transition hover:ring-accent/60"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-bg-soft">
        {progress.poster_url ? (
          <Image
            src={progress.poster_url}
            alt={progress.anime_title}
            fill
            sizes="(max-width: 640px) 70vw, 280px"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-gray-600">
            нет постера
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          Серия {progress.episode} · {formatTime(progress.position_seconds)}
        </span>
        <span className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-accent/90 text-white opacity-0 transition group-hover:opacity-100">
          ▶
        </span>
        {percent !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div
              className="h-full bg-accent"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-gray-100">
          {progress.anime_title}
        </h3>
      </div>
    </Link>
  );
}

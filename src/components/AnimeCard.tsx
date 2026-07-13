import Image from 'next/image';
import Link from 'next/link';
import { imageUrl, type ShikimoriAnimeShort } from '@/lib/shikimori';

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
  const poster = imageUrl(anime.image?.original);
  const title = anime.russian || anime.name;
  const year = anime.aired_on ? anime.aired_on.slice(0, 4) : null;
  const kind = anime.kind ? KIND_LABELS[anime.kind] ?? anime.kind : null;

  return (
    <Link
      href={`/anime/${anime.id}`}
      className="group flex flex-col overflow-hidden rounded-xl bg-bg-card ring-1 ring-white/5 transition hover:ring-accent/60"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
        {poster ? (
          <Image
            src={poster}
            alt={title}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 200px"
            className="object-cover transition duration-300 group-hover:scale-105"
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
      </div>
      <div className="flex flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-gray-100">
          {title}
        </h3>
        <p className="text-xs text-gray-500">
          {[kind, year].filter(Boolean).join(' · ')}
        </p>
      </div>
    </Link>
  );
}

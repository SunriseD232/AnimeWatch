import Link from 'next/link';
import PosterImage from '@/components/PosterImage';
import { audiobookHref, formatDuration, type AudiobookSummary } from '@/lib/audiobookShared';

/**
 * Карточка аудиокниги — та же плитка, что у книги (BookCard): обложка 2:3,
 * «лифт» при наведении. Отличия:
 *   • обложка грузится прямо с knigavuhe — их хранилище отдаёт картинки
 *     без ограничений, и лишний круг через наш прокси не нужен;
 *   • под названием — чтец: у одной книги бывает несколько озвучек, и
 *     выбирают их именно по чтецу; длительность — бейджем на обложке.
 */
export default function AudiobookCard({
  audiobook,
  priority = false,
}: {
  audiobook: AudiobookSummary;
  priority?: boolean;
}) {
  const duration = formatDuration(audiobook.durationSeconds);
  const firstLetter = audiobook.title.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5 hover:ring-accent/60">
      <Link href={audiobookHref(audiobook.id)} prefetch={false} className="flex flex-1 flex-col">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
          {audiobook.coverUrl ? (
            <PosterImage
              sources={[audiobook.coverUrl]}
              alt={audiobook.title}
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
          {duration ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-gray-200">
              {duration}
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{audiobook.title}</h3>
          <p className="mt-auto line-clamp-1 text-xs text-gray-400">
            {audiobook.authors.join(', ') || 'Автор не указан'}
          </p>
          {audiobook.readers.length > 0 ? (
            <p className="line-clamp-1 text-xs text-accent-text">Читает {audiobook.readers.join(', ')}</p>
          ) : null}
        </div>
      </Link>
    </div>
  );
}

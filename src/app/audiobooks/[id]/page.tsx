import Link from 'next/link';
import { notFound } from 'next/navigation';
import ListButton from '@/components/ListButton';
import PosterImage from '@/components/PosterImage';
import AudiobookCard from '@/components/audiobooks/AudiobookCard';
import AudiobookPlayer from '@/components/audiobooks/AudiobookPlayer';
import { getListEntry } from '@/lib/listEntry';
import { getAudiobookDetails, getAudiobooksForBook } from '@/lib/audiobooks';
import { getAudioOffer } from '@/lib/syncOffers';
import { knigavuheBookUrl } from '@/lib/sources/knigavuhe';
import { formatDuration } from '@/lib/audiobookShared';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Главы — со страницы knigavuhe (таймаут 20 с), карта глав книги для
// синхронизации — разбор FB2 при первом открытии (потом из кэша).
export const maxDuration = 60;

/**
 * Аудиокнига: /audiobooks/[id] — карточка и плеер на одной странице: у
 * аудиокниги, в отличие от подкаста, один «выпуск» — сама книга, а главы
 * переключаются внутри плеера.
 *
 * Место восстанавливается из watch_progress (episode — часть, position —
 * секунда в ней). Если книгу (пару во Флибусте) читали позже, чем слушали,
 * плеер предложит продолжить с места из книги (lib/syncOffers.ts).
 */
export default async function AudiobookPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const [audiobook, { data: { user } }, listEntry] = await Promise.all([
    getAudiobookDetails(id),
    getCachedUser(),
    getListEntry('audiobook', id),
  ]);
  if (!audiobook) notFound();

  let progress: WatchProgress | null = null;
  if (user) {
    const { data } = await createClient()
      .from('watch_progress')
      .select('*')
      .eq('content_type', 'audiobook')
      .eq('shikimori_id', id)
      .maybeSingle();
    progress = (data as WatchProgress | null) ?? null;
  }

  const [offer, siblings] = await Promise.all([
    user ? getAudioOffer(audiobook, progress) : Promise.resolve(null),
    audiobook.bookId ? getAudiobooksForBook(audiobook.bookId) : Promise.resolve([]),
  ]);
  const otherNarrations = siblings.filter((item) => item.id !== id);

  const startChapter = progress?.episode && progress.episode > 0 ? progress.episode : 1;
  const startPosition = Math.floor(progress?.position_seconds ?? 0);
  const duration = formatDuration(audiobook.durationSeconds);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <nav className="text-sm text-gray-400">
        <Link href="/audiobooks" className="hover:text-white">
          ← Аудиокниги
        </Link>
      </nav>

      <header className="flex flex-col gap-4 sm:flex-row">
        <div className="aspect-[2/3] w-36 shrink-0 overflow-hidden rounded-2xl bg-bg-soft sm:w-44">
          <PosterImage
            sources={[audiobook.coverUrl]}
            alt={audiobook.title}
            priority
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-bold leading-tight">{audiobook.title}</h1>
          <p className="text-sm text-gray-300">{audiobook.authors.join(', ') || 'Автор не указан'}</p>
          {audiobook.readers.length > 0 ? (
            <p className="text-sm text-gray-400">Читает {audiobook.readers.join(', ')}</p>
          ) : null}
          <p className="text-xs text-gray-500">
            {[duration, audiobook.chapters.length > 0 ? `${audiobook.chapters.length} частей` : null, ...audiobook.genres]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ListButton
              shikimoriId={id}
              contentType="audiobook"
              animeTitle={audiobook.title}
              posterUrl={audiobook.coverUrl}
              initialStatus={listEntry?.status ?? null}
              initialMuted={listEntry?.muted ?? false}
              isAuthed={!!user}
            />
            {audiobook.bookId ? (
              <Link
                href={`/books/${audiobook.bookId}`}
                className="press rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
              >
                Читать книгу
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-inset ring-white/5 sm:p-5">
        <AudiobookPlayer
          audiobookId={id}
          title={audiobook.title}
          authors={audiobook.authors}
          coverUrl={audiobook.coverUrl}
          chapters={audiobook.chapters}
          isAuthed={!!user}
          startChapter={startChapter}
          startPosition={startPosition}
          syncOffer={offer}
        />
      </section>

      {audiobook.description ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Описание</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300">{audiobook.description}</p>
        </section>
      ) : null}

      {otherNarrations.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Другие озвучки</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {otherNarrations.map((item) => (
              <AudiobookCard key={item.id} audiobook={item} />
            ))}
          </div>
        </section>
      ) : null}

      <p className="text-xs text-gray-500">
        Источник —{' '}
        <a
          href={knigavuheBookUrl(audiobook.slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:text-gray-300 hover:underline"
        >
          knigavuhe.org
        </a>
        .
      </p>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import PodcastPlayer from '@/components/podcasts/PodcastPlayer';
import { getPodcastDetails, podcastAudioUrl } from '@/lib/podcasts';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { WatchProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Плеер одного выпуска: /podcasts/listen/[id]/[episode].
 *
 * Эпизод идентифицируется НЕ Apple trackId, а index — позицией в фиде,
 * отсортированном по дате по возрастанию (см. lib/podcasts.ts). Причина
 * проста: фид может содержать сотни выпусков, и любая сортировка, кроме
 * хронологической, сдвигала бы номера при выходе нового выпуска — сохранённый
 * прогресс уезжал бы на соседний эпизод.
 *
 * Ссылку на аудио подписываем ЗДЕСЬ, на сервере (podcastAudioUrl →
 * signRawUrl): в ней HMAC на PROXY_SIGNING_SECRET, и на клиент уходит уже
 * готовый /api/proxy/raw?u=…&s=… — реальный адрес CDN подкаста браузер не
 * видит, mixed content не возникает, хотлинк-запреты обходятся.
 */
export default async function PodcastListenPage({
  params,
}: {
  params: { id: string; episode: string };
}) {
  const id = Number(params.id);
  const episodeIndex = Number(params.episode);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  if (!Number.isSafeInteger(episodeIndex) || episodeIndex <= 0) notFound();

  const [podcast, { data: { user } }] = await Promise.all([getPodcastDetails(id), getCachedUser()]);
  if (!podcast) notFound();

  const episode = podcast.episodes.find((e) => e.index === episodeIndex);
  if (!episode) notFound();

  // Восстановление позиции: только если прогресс на ЭТОМ выпуске и не у самого
  // конца (та же логика, что у аниме/кино, см. watch/[shikimoriId]/[episode]).
  //
  // Сначала — метка этого выпуска (episode_marks, миграция 0065): в ней
  // место каждого начатого выпуска, не только текущего. Нет её — строка
  // watch_progress, если она про этот же выпуск.
  let resumeFrom = 0;
  if (user) {
    const supabase = createClient();
    const [{ data }, { data: mark }] = await Promise.all([
      supabase
        .from('watch_progress')
        .select('*')
        .eq('content_type', 'podcast')
        .eq('shikimori_id', id)
        .maybeSingle(),
      supabase
        .from('episode_marks')
        .select('position_seconds, duration_seconds')
        .eq('content_type', 'podcast')
        .eq('shikimori_id', id)
        .eq('episode', episodeIndex)
        .eq('status', 'in_progress')
        .maybeSingle(),
    ]);
    const progress = (data as WatchProgress | null) ?? null;
    const fromMark = mark?.position_seconds != null ? Number(mark.position_seconds) : null;
    const pos = fromMark ?? (progress && progress.episode === episodeIndex ? progress.position_seconds : 0);
    const dur = fromMark != null ? Number(mark?.duration_seconds ?? 0) : progress?.duration_seconds ?? 0;
    const nearEnd = dur ? pos / dur > 0.9 : false;
    if (pos >= 5 && !nearEnd) resumeFrom = Math.floor(pos);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <nav className="text-sm text-gray-400">
        <Link href={`/podcasts/${id}`} prefetch={false} className="hover:text-white">
          ← {podcast.title}
        </Link>
      </nav>

      <PodcastPlayer
        podcastId={id}
        podcastTitle={podcast.title}
        artworkUrl={podcast.artworkUrl}
        episode={{ ...episode, audioUrl: podcastAudioUrl(episode.audioUrl) }}
        // Подписаны все выпуски: из полоски внизу можно включить следующий,
        // не заходя на его страницу. Подпись — HMAC, сотня выпусков — микросекунды.
        episodes={podcast.episodes.map((e) => ({ ...e, audioUrl: podcastAudioUrl(e.audioUrl) }))}
        isAuthed={Boolean(user)}
        startPosition={resumeFrom}
      />

      {/* Описание выпуска целиком — то, что автор написал в RSS. Пусто — блока
          нет вовсе. */}
      {episode.description ? (
        <section className="flex flex-col gap-2 rounded-2xl bg-bg-card p-4 ring-1 ring-inset ring-white/5">
          <h2 className="text-sm font-semibold text-gray-200">Описание выпуска</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300 [overflow-wrap:anywhere]">
            {episode.description}
          </p>
        </section>
      ) : null}
    </div>
  );
}

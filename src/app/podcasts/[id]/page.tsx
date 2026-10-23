import Link from 'next/link';
import ListButton from '@/components/ListButton';
import { getListEntry } from '@/lib/listEntry';
import { notFound } from 'next/navigation';
import PosterImage from '@/components/PosterImage';
import { formatTime } from '@/lib/format';
import { getPodcastDetails, regionLabel } from '@/lib/podcasts';
import { getCachedUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Страница подкаста: метаданные канала + полный список выпусков.
 *
 * Эпизоды здесь НЕ хранятся у нас — их отдаёт RSS-фид, разобранный на сервере
 * и закэшированный на 30 минут (см. lib/podcasts.ts). В <audio> уходит
 * подписанная ссылка нашего /api/proxy/raw, а не прямой адрес из фида: часть
 * подкастов отдаёт http, а страница у нас https, и браузер такие запросы
 * блокирует (mixed content).
 *
 * Список показывает от НОВЫХ к старым — так подкасты и слушают (новый выпуск
 * сверху), в отличие от серий сериала. Номер выпуска (index в фиде) остаётся
 * хронологическим: 1 — самый старый (см. lib/podcasts.ts), и он же уходит в
 * прогресс.
 */
export default async function PodcastPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  const [podcast, { data: { user } }, listEntry] = await Promise.all([
    getPodcastDetails(id),
    getCachedUser(),
    getListEntry('podcast', id),
  ]);
  if (!podcast) notFound();

  // Свежие сверху, но index при этом не пересчитываем — он исторический.
  const newestFirst = [...podcast.episodes].reverse();
  const firstUnplayed = newestFirst[0] ?? null;
  const region = regionLabel(podcast.country);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-bg-soft ring-1 ring-inset ring-white/5">
          <PosterImage
            sources={[podcast.artworkUrl]}
            alt={podcast.title}
            priority
            className="h-full w-full object-cover"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-bold leading-tight">{podcast.title}</h1>
          {podcast.author ? <p className="text-sm text-gray-300">{podcast.author}</p> : null}
          <p className="text-sm text-gray-400">
            {[podcast.genre, region, podcast.episodeCount ? `${podcast.episodeCount} вып.` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {firstUnplayed ? (
              <Link
                href={`/podcasts/listen/${id}/${firstUnplayed.index}`}
                prefetch={false}
                className="press rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg"
              >
                Слушать
              </Link>
            ) : null}
            <ListButton
              shikimoriId={id}
              contentType="podcast"
              animeTitle={podcast.title}
              posterUrl={podcast.artworkUrl}
              initialStatus={listEntry?.status ?? null}
              initialMuted={listEntry?.muted ?? false}
              isAuthed={!!user}
            />
            {podcast.appleUrl ? (
              <a
                href={podcast.appleUrl}
                target="_blank"
                rel="noreferrer"
                className="press rounded-full bg-bg-soft px-4 py-2.5 text-sm ring-1 ring-white/10 hover:text-white"
              >
                В Apple Podcasts
              </a>
            ) : null}
          </div>

          {!user ? (
            <p className="text-xs text-gray-500">
              Войдите, чтобы прогресс слушания сохранялся между устройствами.
            </p>
          ) : null}
        </div>
      </div>

      {podcast.description ? (
        <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-gray-300">
          {podcast.description}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Выпуски</h2>

        {podcast.episodesUnavailable ? (
          // Фид не отдался (лежит, отдаёт битый XML, отрезал наш User-Agent).
          // Говорим прямо, а не делаем вид, что выпусков нет.
          <p className="rounded-2xl border border-white/5 bg-bg-card p-6 text-sm text-gray-400">
            Список выпусков сейчас недоступен — источник не отвечает. Попробуйте зайти позже
            {podcast.appleUrl ? ' или откройте подкаст в Apple Podcasts.' : '.'}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-white/5 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5">
            {newestFirst.map((ep) => (
              <li key={ep.index}>
                <Link
                  href={`/podcasts/listen/${id}/${ep.index}`}
                  prefetch={false}
                  className="press flex items-center gap-3 p-3 transition hover:bg-bg-soft"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg-soft text-xs tabular-nums text-gray-400">
                    {ep.index}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 text-sm font-medium leading-snug">
                      {ep.title}
                    </span>
                    <span className="text-xs text-gray-400">
                      {[
                        ep.publishedAt
                          ? new Date(ep.publishedAt).toLocaleDateString('ru-RU', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : null,
                        ep.durationSeconds > 0 ? formatTime(ep.durationSeconds) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {/* Описание выпуска из RSS — если оно есть. В списке две
                        строки, чтобы выпуски не превращались в простыню;
                        целиком — на странице выпуска. */}
                    {ep.description ? (
                      <span className="line-clamp-2 text-xs leading-relaxed text-gray-400 [overflow-wrap:anywhere]">
                        {ep.description}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

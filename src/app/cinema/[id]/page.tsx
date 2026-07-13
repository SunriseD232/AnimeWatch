import Link from 'next/link';
import { notFound } from 'next/navigation';
import EpisodeGrid from '@/components/EpisodeGrid';
import ListButton from '@/components/ListButton';
import { getCinemaById } from '@/lib/kodik-catalog';
import { createClient } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';

export default async function CinemaPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const item = await getCinemaById(id);
  if (!item) notFound();

  const title = item.title;
  const total = item.episodesTotal;

  // Прогресс и статус списка для этого тайтла (если пользователь вошёл).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let progress: WatchProgress | null = null;
  let listItem: UserListItem | null = null;

  if (user) {
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase
        .from('watch_progress')
        .select('*')
        .eq('content_type', 'cinema')
        .eq('shikimori_id', id)
        .maybeSingle(),
      supabase
        .from('user_list')
        .select('*')
        .eq('content_type', 'cinema')
        .eq('shikimori_id', id)
        .maybeSingle(),
    ]);
    progress = (p as WatchProgress | null) ?? null;
    listItem = (l as UserListItem | null) ?? null;
  }

  const resumeEpisode = progress?.episode ?? 1;
  const resumePos = progress?.position_seconds ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Шапка */}
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="relative mx-auto aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-xl bg-bg-card ring-1 ring-white/5 sm:mx-0 sm:w-48">
          {item.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.poster}
              alt={title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-600">
              нет постера
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <h1 className="text-2xl font-bold leading-tight">{title}</h1>

          <div className="flex flex-wrap gap-2 text-xs">
            {item.rating !== null && (
              <span className="rounded-md bg-amber-500/15 px-2 py-1 font-medium text-amber-300">
                ★ {item.rating.toFixed(1)}
              </span>
            )}
            {item.kind && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
                {item.kind}
              </span>
            )}
            {item.year && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
                {item.year}
              </span>
            )}
            {item.countries.slice(0, 2).map((c) => (
              <span
                key={c}
                className="rounded-md bg-bg-card px-2 py-1 text-gray-300"
              >
                {c}
              </span>
            ))}
            {item.isSerial && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
                {total} эп.
              </span>
            )}
          </div>

          {item.genres.length > 0 && (
            <p className="text-sm text-gray-400">
              {item.genres.slice(0, 5).join(', ')}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Link
              href={`/cinema/watch/${id}/${resumeEpisode}`}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
            >
              {progress
                ? item.isSerial
                  ? `Продолжить: серия ${resumeEpisode} (${formatTime(resumePos)})`
                  : `Продолжить (${formatTime(resumePos)})`
                : item.isSerial
                  ? 'Начать просмотр'
                  : 'Смотреть'}
            </Link>
            <ListButton
              shikimoriId={id}
              contentType="cinema"
              animeTitle={title}
              posterUrl={item.poster}
              initialStatus={listItem?.status ?? null}
              isAuthed={!!user}
            />
          </div>
        </div>
      </div>

      {/* Описание */}
      {item.description && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Описание</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300">
            {item.description}
          </p>
        </section>
      )}

      {/* Серии (только для сериалов) */}
      {item.isSerial && total > 1 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Серии</h2>
          <EpisodeGrid
            shikimoriId={id}
            total={total}
            currentEpisode={progress?.episode ?? null}
            basePath="/cinema/watch"
          />
        </section>
      )}
    </div>
  );
}

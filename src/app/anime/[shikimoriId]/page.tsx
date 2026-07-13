import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import EpisodeGrid from '@/components/EpisodeGrid';
import ListButton from '@/components/ListButton';
import {
  episodeCount,
  getAnime,
  imageUrl,
  stripBbCode,
} from '@/lib/shikimori';
import { createClient } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';

const KIND_LABELS: Record<string, string> = {
  tv: 'ТВ-сериал',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спешл',
  music: 'Клип',
};

const STATUS_LABELS: Record<string, string> = {
  anons: 'Анонс',
  ongoing: 'Онгоинг',
  released: 'Вышло',
};

export default async function AnimePage({
  params,
}: {
  params: { shikimoriId: string };
}) {
  const id = Number(params.shikimoriId);
  if (!Number.isFinite(id)) notFound();

  let anime;
  try {
    anime = await getAnime(id);
  } catch {
    notFound();
  }

  const title = anime.russian || anime.name;
  const poster = imageUrl(anime.image?.original);
  const total = episodeCount(anime);
  const description = stripBbCode(anime.description);
  const year = anime.aired_on ? anime.aired_on.slice(0, 4) : null;

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
        .eq('shikimori_id', id)
        .maybeSingle(),
      supabase
        .from('user_list')
        .select('*')
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
          {poster ? (
            <Image
              src={poster}
              alt={title}
              fill
              sizes="192px"
              className="object-cover"
              priority
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-600">
              нет постера
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight">{title}</h1>
            {anime.name !== title && (
              <p className="text-sm text-gray-500">{anime.name}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {anime.score && Number(anime.score) > 0 && (
              <span className="rounded-md bg-amber-500/15 px-2 py-1 font-medium text-amber-300">
                ★ {anime.score}
              </span>
            )}
            {anime.kind && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
                {KIND_LABELS[anime.kind] ?? anime.kind}
              </span>
            )}
            {anime.status && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
                {STATUS_LABELS[anime.status] ?? anime.status}
              </span>
            )}
            {year && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
                {year}
              </span>
            )}
            <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
              {total} эп.
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Link
              href={`/watch/${id}/${resumeEpisode}`}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
            >
              {progress
                ? `Продолжить: серия ${resumeEpisode} (${formatTime(resumePos)})`
                : 'Начать просмотр'}
            </Link>
            <ListButton
              shikimoriId={id}
              animeTitle={title}
              posterUrl={poster}
              initialStatus={listItem?.status ?? null}
              isAuthed={!!user}
            />
          </div>
        </div>
      </div>

      {/* Описание */}
      {description && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Описание</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300">
            {description}
          </p>
        </section>
      )}

      {/* Серии */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Серии</h2>
        <EpisodeGrid
          shikimoriId={id}
          total={total}
          currentEpisode={progress?.episode ?? null}
        />
      </section>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import AnimeCard from '@/components/AnimeCard';
import EpisodeGrid from '@/components/EpisodeGrid';
import ListButton from '@/components/ListButton';
import TrailerButton from '@/components/TrailerButton';
import {
  episodeCount,
  getAnime,
  getPrequels,
  getSequels,
  getSimilarAnime,
  imageUrl,
  stripBbCode,
  trailerEmbedUrl,
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
  // Анонс — тайтл ещё не вышел нигде: смотреть нечего, серий тоже нет
  // (episodeCount() всё равно вернёт 1 как заглушку — здесь её не показываем).
  const isAnons = anime.status === 'anons';
  const trailerUrl = trailerEmbedUrl(anime);

  // Прогресс и статус списка для этого тайтла (если пользователь вошёл).
  const supabase = createClient();
  const [{ data: { user } }, prequels, sequels, similar] = await Promise.all([
    supabase.auth.getUser(),
    getPrequels(id),
    getSequels(id),
    getSimilarAnime(id),
  ]);

  let progress: WatchProgress | null = null;
  let listItem: UserListItem | null = null;
  let watchedEpisodes: number[] = [];

  if (user) {
    const [{ data: p }, { data: l }, { data: w }] = await Promise.all([
      supabase
        .from('watch_progress')
        .select('*')
        .eq('content_type', 'anime')
        .eq('shikimori_id', id)
        .maybeSingle(),
      supabase
        .from('user_list')
        .select('*')
        .eq('content_type', 'anime')
        .eq('shikimori_id', id)
        .maybeSingle(),
      supabase
        .from('watched_episodes')
        .select('episode')
        .eq('content_type', 'anime')
        .eq('shikimori_id', id),
    ]);
    progress = (p as WatchProgress | null) ?? null;
    listItem = (l as UserListItem | null) ?? null;
    watchedEpisodes = ((w ?? []) as { episode: number }[]).map(
      (row) => row.episode,
    );
  }

  const resumeEpisode = progress?.episode ?? 1;
  const resumePos = progress?.position_seconds ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Шапка */}
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="relative mx-auto aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 sm:mx-0 sm:w-48">
          {poster ? (
            // <img> + no-referrer: хотлинк-защита Shikimori (см. AnimeCard).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt={title}
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover"
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
            {!isAnons && (
              <span className="rounded-md bg-bg-card px-2 py-1 text-gray-300">
                {total} эп.
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            {isAnons ? (
              <span className="rounded-full bg-bg-card px-5 py-2.5 text-sm font-medium text-gray-400 ring-1 ring-white/10">
                Ещё не вышло — дата выхода не объявлена
              </span>
            ) : (
              <Link
                href={`/watch/${id}/${resumeEpisode}`}
                className="rounded-full press bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
              >
                {progress
                  ? `Продолжить: серия ${resumeEpisode} (${formatTime(resumePos)})`
                  : 'Начать просмотр'}
              </Link>
            )}
            <ListButton
              shikimoriId={id}
              animeTitle={title}
              posterUrl={poster}
              initialStatus={listItem?.status ?? null}
              isAuthed={!!user}
            />
            {trailerUrl && <TrailerButton embedUrl={trailerUrl} />}
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

      {/* Серии — только если тайтл уже вышел */}
      {!isAnons && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Серии</h2>
          <EpisodeGrid
            shikimoriId={id}
            total={total}
            currentEpisode={progress?.episode ?? null}
            watchedEpisodes={watchedEpisodes}
          />
        </section>
      )}

      {/* Предыдущий сезон (приквел франшизы) */}
      {prequels.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Предыдущий сезон</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {prequels.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}

      {/* Продолжение (сиквел франшизы) */}
      {sequels.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Продолжение</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {sequels.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}

      {/* Похожее */}
      {similar.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Похожее</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {similar.map((a) => (
              <AnimeCard key={a.id} anime={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

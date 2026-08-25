import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import CinemaCard from '@/components/CinemaCard';
import CinemaEpisodes from '@/components/CinemaEpisodes';
import DownloadButton from '@/components/DownloadButton';
import ListButton from '@/components/ListButton';
import TrailerButton from '@/components/TrailerButton';
import { getCinemaById, getCinemaCatalog, type CinemaShort } from '@/lib/videoseed-catalog';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { buildVideoseedEmbedUrl } from '@/lib/video/videoseed';
import { getVibixEmbed } from '@/lib/video/vibix';
import { createVideoSource } from '@/lib/video/kodik';

/**
 * «Похожее» — самая необязательная секция страницы (и потенциально самая
 * медленная, см. collectFiltered в videoseed-catalog.ts: перебор страниц
 * каталога у редких жанров). Отдельный async-компонент под своим Suspense
 * ниже — стримится ОТДЕЛЬНЫМ чанком, не блокируя постер/кнопку «Смотреть»/
 * список серий выше, которые готовы значительно раньше.
 */
async function SimilarCinemaTitles({ id, genre }: { id: number; genre: string | null }) {
  if (!genre) return null;
  let similar: CinemaShort[] = [];
  try {
    const catalogPage = await getCinemaCatalog({
      type: 'both',
      genresInclude: [genre],
      genresExclude: [],
      sort: 'rating',
      page: 1,
      pageSize: 13,
    });
    similar = catalogPage.items.filter((s) => s.id !== id).slice(0, 12);
  } catch {
    similar = [];
  }
  if (similar.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Похожее</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {similar.map((s) => (
          <CinemaCard key={s.id} item={s} />
        ))}
      </div>
    </section>
  );
}

function SimilarCinemaTitlesSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <div className="skeleton h-6 w-32 rounded-md" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="skeleton aspect-[2/3] w-full rounded-2xl" />
        ))}
      </div>
    </section>
  );
}

export default async function CinemaPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const supabase = createClient();

  // Проверка доступности плеера (Vibix/Kodik) не зависит ни от item, ни от
  // user — запускаем сразу, параллельно со всем остальным резолвом
  // страницы (раньше шла ПОСЛЕДНЕЙ, строго после всего прочего). Страница
  // и так тяжелее анимешной (несколько внешних API), а чем дольше она
  // резолвится, тем выше шанс поймать клиентский роутер Next.js в гонке
  // между автопрефетчем карточки и реальным переходом по клику — см.
  // CinemaCard.tsx. Само по себе быстрее для всех, независимо от этого.
  const hasAnyPlayerPromise = (async () => {
    let hasAnyPlayer = buildVideoseedEmbedUrl({ kinopoiskId: id }) !== null;
    if (!hasAnyPlayer) {
      const [vibixCheck, kodikCheck] = await Promise.all([
        getVibixEmbed(id),
        createVideoSource().getEmbedUrl({ kinopoiskId: id, episode: 1 }),
      ]);
      hasAnyPlayer = vibixCheck !== null || !kodikCheck.fallback;
    }
    return hasAnyPlayer;
  })();

  const [item, {
    data: { user },
  }] = await Promise.all([getCinemaById(id), getCachedUser()]);
  if (!item) notFound();

  const title = item.title;
  const total = item.episodesTotal;

  // Прогресс и статус списка для этого тайтла (если пользователь вошёл).
  const progressPromise = user
    ? Promise.all([
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
        supabase
          .from('watched_episodes')
          .select('season, episode')
          .eq('content_type', 'cinema')
          .eq('shikimori_id', id),
      ])
    : null;

  const [hasAnyPlayer, progressResult] = await Promise.all([
    hasAnyPlayerPromise,
    progressPromise,
  ]);

  let progress: WatchProgress | null = null;
  let listItem: UserListItem | null = null;
  let watched: { season: number; episode: number }[] = [];

  if (progressResult) {
    const [{ data: p }, { data: l }, { data: w }] = progressResult;
    progress = (p as WatchProgress | null) ?? null;
    listItem = (l as UserListItem | null) ?? null;
    watched = (w ?? []) as { season: number; episode: number }[];
  }

  const resumeSeason = progress?.season ?? 1;
  const resumeEpisode = progress?.episode ?? 1;
  const resumePos = progress?.position_seconds ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Шапка — постер как размытая подложка на весь блок (см. ту же
          обёртку на странице аниме). */}
      <div className="relative">
        {item.poster && (
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 overflow-hidden rounded-3xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.poster}
              alt=""
              className="h-full w-full scale-110 object-cover object-top opacity-40 blur-3xl"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
          </div>
        )}
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-8">
        <div className="relative mx-auto aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 sm:mx-0 sm:w-48">
          {item.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.poster}
              alt={title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-gray-400">
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
            <div className="flex flex-wrap gap-1.5">
              {item.genres.slice(0, 5).map((g) => (
                <Link
                  key={g}
                  href={`/cinema/catalog?genres=${encodeURIComponent(g)}`}
                  className="rounded-full bg-bg-card px-2.5 py-1 text-xs text-gray-300 ring-1 ring-white/5 transition hover:text-white hover:ring-accent/60"
                >
                  {g}
                </Link>
              ))}
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-3">
            {hasAnyPlayer ? (
              <Link
                href={`/cinema/watch/${id}/${resumeSeason}/${resumeEpisode}`}
                className="rounded-full press bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
              >
                {progress
                  ? item.isSerial
                    ? `Продолжить: серия ${resumeEpisode} (${formatTime(resumePos)})`
                    : `Продолжить (${formatTime(resumePos)})`
                  : item.isSerial
                    ? 'Начать просмотр'
                    : 'Смотреть'}
              </Link>
            ) : (
              <span className="rounded-full bg-bg-card px-5 py-2.5 text-sm font-semibold text-gray-400 ring-1 ring-white/10">
                Сейчас нет в каталоге
              </span>
            )}
            <ListButton
              shikimoriId={id}
              contentType="cinema"
              animeTitle={title}
              posterUrl={item.poster}
              initialStatus={listItem?.status ?? null}
              initialMuted={listItem?.muted ?? false}
              isAuthed={!!user}
            />
            {hasAnyPlayer && (
              <DownloadButton
                isAuthed={!!user}
                contentType="cinema"
                contentId={id}
                title={title}
                posterUrl={item.poster}
                isSerial={item.isSerial}
                totalEpisodes={total}
                seasons={item.seasons}
              />
            )}
            {/* Для сериалов трейлер — внутри CinemaEpisodes, по сезонам */}
            {!item.isSerial && item.idImdb && (
              <TrailerButton fetchUrl={`/api/trailer?imdbId=${item.idImdb}`} />
            )}
          </div>
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
      {item.isSerial && total > 1 && item.seasons.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Серии</h2>
          <CinemaEpisodes
            shikimoriId={id}
            seasons={item.seasons}
            currentSeason={progress?.season ?? null}
            currentEpisode={progress?.episode ?? null}
            watched={watched}
            idImdb={item.idImdb}
            title={title}
            posterUrl={item.poster}
          />
        </section>
      )}

      {/* Похожее — отдельный стрим, см. SimilarCinemaTitles/комментарий вверху файла. */}
      <Suspense fallback={<SimilarCinemaTitlesSkeleton />}>
        <SimilarCinemaTitles id={id} genre={item.genres[0] ?? null} />
      </Suspense>
    </div>
  );
}

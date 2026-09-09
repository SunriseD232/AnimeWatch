import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import DownloadButton from '@/components/DownloadButton';
import EpisodeGrid from '@/components/EpisodeGrid';
import ListButton from '@/components/ListButton';
import { RelatedAnimeSections, RelatedAnimeSectionsSkeleton } from '@/components/RelatedAnimeSections';
import TrailerButton from '@/components/TrailerButton';
import PosterImage from '@/components/PosterImage';
import {
  episodeCount,
  getAnime,
  imageUrl,
  stripBbCode,
  trailerEmbedUrl,
} from '@/lib/shikimori';
import { createClient, getCachedUser } from '@/lib/supabase/server';
import type { UserListItem, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { KIND_LABELS, STATUS_LABELS } from '@/lib/animeLabels';
import { getIndexedTitle } from '@/lib/animeIndexQuery';


export default async function AnimePage({
  params,
}: {
  params: { shikimoriId: string };
}) {
  const id = Number(params.shikimoriId);
  if (!Number.isFinite(id)) notFound();

  // getAnime и getUser независимы — запускаем параллельно (см. тот же приём
  // и его обоснование в app/watch/[shikimoriId]/[episode]/page.tsx).
  const userPromise = getCachedUser();
  let anime;
  try {
    anime = await getAnime(id);
  } catch {
    notFound();
  }

  const title = anime.russian || anime.name;
  // Постер сперва из индекса: у Shikimori часть карточек отдаёт битую
  // ссылку, и страница тайтла показывала «404», хотя в каталоге тот же тайтл
  // был с обложкой — каталог давно читает индекс, а сюда ходил REST.
  // Из локального индекса берём и жанры (чтобы id совпадали с фильтром
  // каталога), и постер. Запрос дешёвый: одна строка по первичному ключу
  // плюс выборка названий жанров.
  const indexed = await getIndexedTitle(id);
  const indexedGenres = indexed?.genres ?? null;

  const poster = indexed?.poster ?? imageUrl(anime.image?.original);
  const total = episodeCount(anime);
  const description = stripBbCode(anime.description);
  const year = anime.aired_on ? anime.aired_on.slice(0, 4) : null;
  // Анонс — тайтл ещё не вышел нигде: смотреть нечего, серий тоже нет
  // (episodeCount() всё равно вернёт 1 как заглушку — здесь её не показываем).
  const isAnons = anime.status === 'anons';
  const trailerUrl = trailerEmbedUrl(anime);

  // Прогресс и статус списка для этого тайтла (если пользователь вошёл).
  const supabase = createClient();
  const {
    data: { user },
  } = await userPromise;

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
      {/* Шапка — постер как размытая подложка на весь блок: без этого на
          широких экранах справа от небольшого постера была просто пустая
          чёрная область. */}
      <div className="relative">
        {poster && (
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 overflow-hidden rounded-3xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={poster}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full scale-110 object-cover object-top opacity-40 blur-3xl"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
          </div>
        )}
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-8">
          <div className="relative mx-auto aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 sm:mx-0 sm:w-48">
            {/* Запасные ссылки — на случай, когда основная отдаёт 404:
                постер из индекса, оригинал Shikimori, его же превью. */}
            <PosterImage
              sources={[poster, imageUrl(anime.image?.original), imageUrl(anime.image?.preview)]}
              alt={title}
              loading="eager"
              className="absolute inset-0 h-full w-full object-cover"
              placeholderClassName="grid h-full w-full place-items-center text-gray-400"
            />
          </div>

          <div className="flex flex-1 flex-col gap-3">
          <div>
            <h1 className="text-2xl font-bold leading-tight">{title}</h1>
            {anime.name !== title && (
              <p className="text-sm text-gray-400">{anime.name}</p>
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

          {/* Жанры ссылками на каталог. Берём их из локального индекса, а не
              из карточки Shikimori: у той легаси-id, и ссылка открыла бы
              фильтр, который ничего не находит (см. getIndexedTitle). Индекса
              нет — показываем подписи Shikimori без ссылок. */}
          {indexedGenres && indexedGenres.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {indexedGenres.map((g) => (
                <Link
                  key={g.id}
                  href={`/catalog?genres=${g.id}`}
                  className="press rounded-md bg-bg-card px-2 py-1 text-xs text-gray-300 transition hover:bg-accent/15 hover:text-accent"
                >
                  {g.russian}
                </Link>
              ))}
            </div>
          ) : anime.genres && anime.genres.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {anime.genres.map((g) => (
                <span
                  key={g.id}
                  className="rounded-md bg-bg-card px-2 py-1 text-xs text-gray-400"
                >
                  {g.russian}
                </span>
              ))}
            </div>
          ) : null}

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
              initialMuted={listItem?.muted ?? false}
              isAuthed={!!user}
            />
            {!isAnons && (
              <DownloadButton
                isAuthed={!!user}
                contentType="anime"
                contentId={id}
                title={title}
                posterUrl={poster}
                isSerial={total > 1}
                totalEpisodes={total}
              />
            )}
            {trailerUrl && <TrailerButton embedUrl={trailerUrl} />}
          </div>
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
            title={title}
            posterUrl={poster}
          />
        </section>
      )}

      {/* Приквел/сиквел/похожее — отдельный стрим, см. RelatedAnimeSections/
          комментарий вверху файла. */}
      <Suspense fallback={<RelatedAnimeSectionsSkeleton />}>
        <RelatedAnimeSections id={id} />
      </Suspense>
    </div>
  );
}

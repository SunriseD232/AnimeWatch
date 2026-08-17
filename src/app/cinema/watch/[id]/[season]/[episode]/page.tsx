import { notFound } from 'next/navigation';
import Player from '@/components/Player';
import { getCinemaById } from '@/lib/videoseed-catalog';
import { createClient } from '@/lib/supabase/server';
import { getVibixEmbed } from '@/lib/video/vibix';
import { resolveCinemaEpisodeSources } from '@/lib/watch/resolveCinemaEpisode';
import type { WatchProgress } from '@/lib/types';

export const metadata = { title: 'Просмотр — MediaWatch' };

export default async function CinemaWatchPage({
  params,
}: {
  params: { id: string; season: string; episode: string };
}) {
  const kinopoiskId = Number(params.id);
  const season = Number(params.season);
  const episode = Number(params.episode);
  if (
    !Number.isFinite(kinopoiskId) ||
    !Number.isFinite(season) ||
    season < 1 ||
    !Number.isFinite(episode) ||
    episode < 1
  ) {
    notFound();
  }

  // Метаданные тайтла (название/постер/сезоны).
  const item = await getCinemaById(kinopoiskId);
  if (!item) notFound();

  const title = item.title;
  const posterUrl = item.poster;

  // Прогресс пользователя по этому тайтлу.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let progress: WatchProgress | null = null;
  if (user) {
    const { data } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('content_type', 'cinema')
      .eq('shikimori_id', kinopoiskId)
      .maybeSingle();
    progress = (data as WatchProgress | null) ?? null;
  }

  // Восстановление позиции: только если прогресс на ЭТОЙ серии сезона и не у конца.
  let resumeFrom: number | null = null;
  let otherSeason: number | null = null;
  let otherEpisode: number | null = null;

  if (progress) {
    const progressSeason = progress.season ?? 1;
    if (progressSeason === season && progress.episode === episode) {
      const pos = progress.position_seconds;
      const dur = progress.duration_seconds;
      const nearEnd = dur ? pos / dur > 0.9 : false;
      if (pos >= 5 && !nearEnd) {
        resumeFrom = Math.floor(pos);
      }
    } else {
      otherSeason = progressSeason;
      otherEpisode = progress.episode;
    }
  }

  const initialTranslationId = progress?.translation_id ?? null;
  // Для OwnPlayer/Kodik: video_id Yummy у аниме не стабилен между сериями,
  // поэтому там сопоставляют по названию (см. миграцию 0008) — у Kodik id
  // озвучки стабилен и без этого, но переиспользуем тот же механизм ради
  // единообразия с OwnPlayer.tsx (там персистентность всегда по title).
  const savedTranslationTitle = progress?.translation_title ?? null;

  // Vibix — заголовок-уровня (один и тот же embed на весь тайтл, серию/сезон
  // передаём прямо в его iframe-SDK, см. VibixPlayer.tsx) — не часть общего
  // резолвера серии (resolveCinemaEpisodeSources), т.к. не завязан на неё.
  const [vibixEmbed, sources] = await Promise.all([
    getVibixEmbed(kinopoiskId),
    resolveCinemaEpisodeSources({
      kinopoiskId,
      season,
      episode,
      isSerial: item.isSerial,
      translationId: initialTranslationId,
      resumeFrom,
    }),
  ]);

  // Число серий в текущем сезоне (для «Серия X из Y»).
  const seasonInfo = item.seasons.find((s) => s.season === season);
  const seasonEpisodes =
    seasonInfo?.episodes ?? (item.isSerial ? item.episodesTotal : 1);

  return (
    <Player
      shikimoriId={kinopoiskId}
      contentType="cinema"
      season={season}
      episode={episode}
      seasons={item.seasons}
      total={seasonEpisodes}
      animeTitle={title}
      posterUrl={posterUrl}
      initialEmbedUrl={sources.kodikEmbedUrl}
      vibixEmbed={vibixEmbed}
      videoseedUrl={sources.videoseedUrl}
      videoseedStart={sources.videoseedStart}
      allohaUrl={sources.allohaUrl}
      durationSeconds={item.durationSeconds}
      translations={sources.kodikTranslations}
      initialTranslationId={sources.kodikInitialTranslationId}
      ownPlayerTranslations={sources.ownPlayerTranslations}
      savedTranslationTitle={savedTranslationTitle}
      savedTranslationId={initialTranslationId}
      resumeFrom={resumeFrom}
      otherSeason={otherSeason}
      otherEpisode={otherEpisode}
      fallback={sources.kodikFallback}
      isAuthed={!!user}
    />
  );
}

import { notFound } from 'next/navigation';
import Player from '@/components/Player';
import { getCinemaById } from '@/lib/videoseed-catalog';
import { createClient } from '@/lib/supabase/server';
import { createVideoSource } from '@/lib/video/kodik';
import { buildVideoseedEmbedUrl } from '@/lib/video/videoseed';
import { getVibixEmbed } from '@/lib/video/vibix';
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

  // Kodik (второстепенный) и Vibix (основной, точный трекинг) — параллельно.
  const source = createVideoSource();
  const [embed, vibixEmbed] = await Promise.all([
    source.getEmbedUrl({
      kinopoiskId,
      season,
      episode,
      translationId: initialTranslationId ?? undefined,
      startFrom: resumeFrom ?? undefined,
    }),
    getVibixEmbed(kinopoiskId),
  ]);

  const resolvedTranslationId =
    initialTranslationId ?? embed.translations[0]?.id ?? null;

  // Videoseed (основной) — embed_auto по kinopoisk_id, video=sСЕЗОНvСЕРИЯ.
  // Стартуем на 15 сек раньше сохранённой позиции: позиция с Videoseed
  // приблизительная (оценщик), а начать чуть раньше приятнее, чем позже.
  const videoseedStart =
    resumeFrom !== null ? Math.max(0, resumeFrom - 15) : 0;
  const videoseedUrl = buildVideoseedEmbedUrl({
    kinopoiskId,
    season,
    episode,
    isSerial: item.isSerial,
    startFrom: videoseedStart > 0 ? videoseedStart : undefined,
  });

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
      initialEmbedUrl={embed.embedUrl}
      vibixEmbed={vibixEmbed}
      videoseedUrl={videoseedUrl}
      videoseedStart={videoseedStart}
      durationSeconds={item.durationSeconds}
      translations={embed.translations}
      initialTranslationId={resolvedTranslationId}
      resumeFrom={resumeFrom}
      otherSeason={otherSeason}
      otherEpisode={otherEpisode}
      fallback={embed.fallback}
      isAuthed={!!user}
    />
  );
}

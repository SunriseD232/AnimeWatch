import { notFound } from 'next/navigation';
import Player from '@/components/Player';
import { getCinemaById } from '@/lib/kodik-catalog';
import { createClient } from '@/lib/supabase/server';
import { createVideoSource } from '@/lib/video/kodik';
import type { WatchProgress } from '@/lib/types';

export const metadata = { title: 'Просмотр — AnimeWatch' };

export default async function CinemaWatchPage({
  params,
}: {
  params: { id: string; episode: string };
}) {
  const kinopoiskId = Number(params.id);
  const episode = Number(params.episode);
  if (
    !Number.isFinite(kinopoiskId) ||
    !Number.isFinite(episode) ||
    episode < 1
  ) {
    notFound();
  }

  // Метаданные тайтла (название/постер/число серий).
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

  // Восстановление позиции: только если прогресс на ЭТОЙ серии и не у самого конца.
  let resumeFrom: number | null = null;
  let otherEpisode: number | null = null;

  if (progress) {
    if (progress.episode === episode) {
      const pos = progress.position_seconds;
      const dur = progress.duration_seconds;
      const nearEnd = dur ? pos / dur > 0.9 : false;
      if (pos >= 5 && !nearEnd) {
        resumeFrom = Math.floor(pos);
      }
    } else {
      otherEpisode = progress.episode;
    }
  }

  const initialTranslationId = progress?.translation_id ?? null;

  // Получаем embed через абстракцию VideoSource (Kodik, поиск по kinopoisk_id).
  const source = createVideoSource();
  const embed = await source.getEmbedUrl({
    kinopoiskId,
    episode,
    translationId: initialTranslationId ?? undefined,
    startFrom: resumeFrom ?? undefined,
  });

  const total = embed.episodesTotal ?? item.episodesTotal;
  const resolvedTranslationId =
    initialTranslationId ?? embed.translations[0]?.id ?? null;

  return (
    <Player
      shikimoriId={kinopoiskId}
      contentType="cinema"
      episode={episode}
      total={total}
      animeTitle={title}
      posterUrl={posterUrl}
      initialEmbedUrl={embed.embedUrl}
      translations={embed.translations}
      initialTranslationId={resolvedTranslationId}
      resumeFrom={resumeFrom}
      otherEpisode={otherEpisode}
      fallback={embed.fallback}
      isAuthed={!!user}
    />
  );
}

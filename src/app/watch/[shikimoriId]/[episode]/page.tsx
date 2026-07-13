import { notFound } from 'next/navigation';
import WatchPlayer from '@/components/WatchPlayer';
import { episodeCount, getAnime, imageUrl } from '@/lib/shikimori';
import { createClient } from '@/lib/supabase/server';
import { createVideoSource } from '@/lib/video/kodik';
import type { WatchProgress } from '@/lib/types';

export const metadata = { title: 'Просмотр — AnimeWatch' };

export default async function WatchPage({
  params,
}: {
  params: { shikimoriId: string; episode: string };
}) {
  const shikimoriId = Number(params.shikimoriId);
  const episode = Number(params.episode);
  if (
    !Number.isFinite(shikimoriId) ||
    !Number.isFinite(episode) ||
    episode < 1
  ) {
    notFound();
  }

  // Метаданные тайтла (название/постер/число серий).
  let anime;
  try {
    anime = await getAnime(shikimoriId);
  } catch {
    notFound();
  }
  const animeTitle = anime.russian || anime.name;
  const posterUrl = imageUrl(anime.image?.original);

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
      .eq('shikimori_id', shikimoriId)
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

  // Получаем embed через абстракцию VideoSource (Kodik).
  const source = createVideoSource();
  const embed = await source.getEmbedUrl({
    shikimoriId,
    episode,
    translationId: initialTranslationId ?? undefined,
    startFrom: resumeFrom ?? undefined,
  });

  // Число серий берём из Shikimori (согласовано с сеткой на странице тайтла).
  const total = episodeCount(anime);
  const resolvedTranslationId =
    initialTranslationId ?? embed.translations[0]?.id ?? null;
  const animeYear = anime.aired_on
    ? Number(anime.aired_on.slice(0, 4)) || null
    : null;

  return (
    <WatchPlayer
      shikimoriId={shikimoriId}
      episode={episode}
      total={total}
      animeTitle={animeTitle}
      posterUrl={posterUrl}
      animeRomaji={anime.name}
      animeRussian={anime.russian}
      animeYear={animeYear}
      resumeFrom={resumeFrom}
      otherEpisode={otherEpisode}
      isAuthed={!!user}
      kodikEmbedUrl={embed.embedUrl}
      kodikTranslations={embed.translations}
      kodikInitialTranslationId={resolvedTranslationId}
      kodikFallback={embed.fallback}
    />
  );
}

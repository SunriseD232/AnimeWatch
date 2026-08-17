import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import WatchPlayer from '@/components/WatchPlayer';
import { RelatedAnimeSections, RelatedAnimeSectionsSkeleton } from '@/components/RelatedAnimeSections';
import { episodeCount, getAnime, imageUrl } from '@/lib/shikimori';
import { createClient } from '@/lib/supabase/server';
import { resolveAnimeEpisodeSources } from '@/lib/watch/resolveAnimeEpisode';
import type { WatchProgress } from '@/lib/types';

export const metadata = { title: 'Просмотр — MediaWatch' };

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
      .eq('content_type', 'anime')
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
  // Для OwnPlayer/Alloha: video_id Yummy не стабилен между сериями, поэтому
  // сохранённую озвучку сопоставляем по текстовой метке (см. миграцию 0008),
  // а не по id.
  const savedTranslationTitle = progress?.translation_title ?? null;

  // Kodik как fallback (AniLibria подбирается на клиенте), Yummy (второй
  // резервный источник + тайминги пропуска опенинга/эндинга) — это то, что
  // реально нужно, чтобы показать плеер. Подсказки «продолжение»/«похожее»
  // под плеером раньше тоже сидели в этом Promise.all — три отдельных похода
  // к Shikimori API, вообще не нужных для самого плеера, задерживали его
  // наравне с ними. Теперь ниже, в своём Suspense (см. RelatedAnimeSections).
  const sources = await resolveAnimeEpisodeSources({
    shikimoriId,
    episode,
    translationId: initialTranslationId,
    resumeFrom,
  });

  const total = sources.episodesTotal ?? episodeCount(anime);
  const animeYear = anime.aired_on
    ? Number(anime.aired_on.slice(0, 4)) || null
    : null;

  return (
    <div className="flex flex-col gap-4">
      <WatchPlayer
        shikimoriId={shikimoriId}
        contentType="anime"
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
        isOngoing={anime.status === 'ongoing'}
        kodikEmbedUrl={sources.kodikEmbedUrl}
        kodikTranslations={sources.kodikTranslations}
        kodikInitialTranslationId={sources.kodikInitialTranslationId}
        kodikFallback={sources.kodikFallback}
        yummyTranslations={sources.yummyTranslations}
        realdebridTranslations={sources.realdebridTranslations}
        savedTranslationTitle={savedTranslationTitle}
        skipOpening={sources.skipOpening}
        skipEnding={sources.skipEnding}
      />
      <Suspense fallback={<RelatedAnimeSectionsSkeleton compact />}>
        <RelatedAnimeSections id={shikimoriId} compact similarLimit={6} />
      </Suspense>
    </div>
  );
}

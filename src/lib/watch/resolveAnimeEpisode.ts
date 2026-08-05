import { createVideoSource } from '@/lib/video/kodik';
import { getYummyEpisode, type YummyTranslation } from '@/lib/video/yummy';
import type { Translation } from '@/lib/video/types';

interface SkipSegment {
  time: number;
  length: number;
}

export interface AnimeEpisodeSources {
  kodikEmbedUrl: string;
  kodikTranslations: Translation[];
  kodikInitialTranslationId: number | null;
  kodikFallback: boolean;
  episodesTotal: number | null;
  yummyTranslations: YummyTranslation[];
  skipOpening: SkipSegment | null;
  skipEnding: SkipSegment | null;
}

/**
 * Разрешает Kodik/Yummy источники для ОДНОЙ серии аниме — общая логика между
 * исходным SSR-роутом (watch/[shikimoriId]/[episode]/page.tsx) и лёгким API
 * бесшовного переключения (api/watch/anime/.../route.ts). AniLibria сюда не
 * входит — она уже резолвится на клиенте (см. WatchPlayer.tsx useEffect по
 * [episode]), сервер тут не нужен.
 */
export async function resolveAnimeEpisodeSources({
  shikimoriId,
  episode,
  translationId,
  resumeFrom,
}: {
  shikimoriId: number;
  episode: number;
  translationId: number | null;
  resumeFrom: number | null;
}): Promise<AnimeEpisodeSources> {
  const source = createVideoSource();
  const [embed, yummy] = await Promise.all([
    source.getEmbedUrl({
      shikimoriId,
      episode,
      translationId: translationId ?? undefined,
      startFrom: resumeFrom ?? undefined,
    }),
    getYummyEpisode(shikimoriId, episode),
  ]);

  const resolvedTranslationId = translationId ?? embed.translations[0]?.id ?? null;

  return {
    kodikEmbedUrl: embed.embedUrl,
    kodikTranslations: embed.translations,
    kodikInitialTranslationId: resolvedTranslationId,
    kodikFallback: embed.fallback,
    episodesTotal: embed.episodesTotal,
    yummyTranslations: yummy?.translations ?? [],
    skipOpening: yummy?.skipOpening ?? null,
    skipEnding: yummy?.skipEnding ?? null,
  };
}

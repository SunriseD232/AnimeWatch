import { createVideoSource } from '@/lib/video/kodik';
import { getYummyEpisode, type YummyTranslation } from '@/lib/video/yummy';
import type { Translation } from '@/lib/video/types';
import type { OwnPlayerTranslation } from '@/lib/extract/types';

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
  /** AllDebrid — отдельно от yummyTranslations: тот список идёт ЕЩЁ и в
   *  iframe-плеер Yummy (см. WatchPlayer.tsx), а у AllDebrid нет embedUrl
   *  для iframe, только для «Наш плеер» (см. resolveCinemaEpisode.ts —
   *  тот же приём для кино). */
  alldebridTranslations: OwnPlayerTranslation[];
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
    // Доступность конкретного торрента по Kitsu id известна только в момент
    // резолва (см. alldebridResolve.ts) — вкладку добавляем всегда, а не
    // найдётся источник, «Наш плеер» покажет обычную ошибку, как для любого
    // другого несработавшего экстракта.
    alldebridTranslations: [{ id: -1, title: 'AllDebrid', embedUrl: '', source: 'alldebrid' }],
    skipOpening: yummy?.skipOpening ?? null,
    skipEnding: yummy?.skipEnding ?? null,
  };
}

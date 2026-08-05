import { createVideoSource, getKodikOwnPlayerTranslations } from '@/lib/video/kodik';
import { buildVideoseedEmbedUrl } from '@/lib/video/videoseed';
import { getVideoseedOwnPlayerTranslations } from '@/lib/videoseed-catalog';
import type { OwnPlayerTranslation } from '@/lib/extract/types';
import type { Translation } from '@/lib/video/types';

export interface CinemaEpisodeSources {
  kodikEmbedUrl: string;
  kodikTranslations: Translation[];
  kodikInitialTranslationId: number | null;
  kodikFallback: boolean;
  /** null — токен Videoseed не задан. */
  videoseedUrl: string | null;
  videoseedStart: number;
  ownPlayerTranslations: OwnPlayerTranslation[];
}

/**
 * Разрешает Kodik/Videoseed/«Наш плеер» источники для ОДНОЙ серии кино —
 * общая логика между исходным SSR-роутом (cinema/watch/.../page.tsx, полная
 * навигация/прямые ссылки) и лёгким API для бесшовного переключения серии
 * (api/watch/cinema/.../route.ts) — держим в одном месте, чтобы не разъехались.
 */
export async function resolveCinemaEpisodeSources({
  kinopoiskId,
  season,
  episode,
  isSerial,
  translationId,
  resumeFrom,
}: {
  kinopoiskId: number;
  season: number;
  episode: number;
  isSerial: boolean;
  translationId: number | null;
  resumeFrom: number | null;
}): Promise<CinemaEpisodeSources> {
  const source = createVideoSource();
  const [embed, kodikOwnPlayerTranslations, videoseedOwnPlayerTranslations] =
    await Promise.all([
      source.getEmbedUrl({
        kinopoiskId,
        season,
        episode,
        translationId: translationId ?? undefined,
        startFrom: resumeFrom ?? undefined,
      }),
      getKodikOwnPlayerTranslations(kinopoiskId, season, episode),
      getVideoseedOwnPlayerTranslations(kinopoiskId, season, episode),
    ]);

  const resolvedTranslationId = translationId ?? embed.translations[0]?.id ?? null;

  // Стартуем на 15 сек раньше сохранённой позиции: позиция с Videoseed
  // приблизительная (оценщик), а начать чуть раньше приятнее, чем позже.
  const videoseedStart = resumeFrom !== null ? Math.max(0, resumeFrom - 15) : 0;
  const videoseedUrl = buildVideoseedEmbedUrl({
    kinopoiskId,
    season,
    episode,
    isSerial,
    startFrom: videoseedStart > 0 ? videoseedStart : undefined,
  });

  // «Наш плеер»: озвучки Kodik первыми (дешёвое извлечение), Videoseed следом
  // (Puppeteer) — см. тот же комментарий в исходном page.tsx.
  const ownPlayerTranslations: OwnPlayerTranslation[] = [
    ...kodikOwnPlayerTranslations,
    ...(videoseedOwnPlayerTranslations.length > 0
      ? videoseedOwnPlayerTranslations
      : videoseedUrl
        ? [{ id: 0, title: 'Videoseed', embedUrl: '', source: 'videoseed' as const }]
        : []),
  ];

  return {
    kodikEmbedUrl: embed.embedUrl,
    kodikTranslations: embed.translations,
    kodikInitialTranslationId: resolvedTranslationId,
    kodikFallback: embed.fallback,
    videoseedUrl,
    videoseedStart,
    ownPlayerTranslations,
  };
}

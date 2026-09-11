import { createVideoSource } from '@/lib/video/kodik';
import { getYummyEpisode, type YummyTranslation } from '@/lib/video/yummy';
import { findFranchiseFallback, type FranchiseFallback } from '@/lib/watch/franchiseFallback';
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
  /** Real-Debrid — отдельно от yummyTranslations: тот список идёт ЕЩЁ и в
   *  iframe-плеер Yummy (см. WatchPlayer.tsx), а у Real-Debrid нет embedUrl
   *  для iframe, только для «Наш плеер» (см. resolveCinemaEpisode.ts —
   *  тот же приём для кино). */
  realdebridTranslations: OwnPlayerTranslation[];
  skipOpening: SkipSegment | null;
  skipEnding: SkipSegment | null;
  /** «Эта часть есть у источников под другим тайтлом» — только когда своих
   *  источников не нашлось ни одного, см. lib/watch/franchiseFallback.ts. */
  franchiseFallback: FranchiseFallback | null;
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

  // Подсказку про франшизу считаем ТОЛЬКО когда искать больше нечего: у
  // Kodik сработал общий find-player (embed.fallback — значит по id он
  // тайтл не знает), и у Yummy пусто. На рабочем тайтле сюда не заходим
  // вовсе, лишних запросов на обычном пути просмотра нет.
  const nothingFound = embed.fallback && (yummy?.translations.length ?? 0) === 0;
  const franchiseFallback = nothingFound
    ? await findFranchiseFallback(shikimoriId, episode)
    : null;

  return {
    kodikEmbedUrl: embed.embedUrl,
    kodikTranslations: embed.translations,
    kodikInitialTranslationId: resolvedTranslationId,
    kodikFallback: embed.fallback,
    episodesTotal: embed.episodesTotal,
    yummyTranslations: yummy?.translations ?? [],
    // Real-Debrid по умолчанию СКРЫТ от пользователя.
    //
    // Раньше вкладка добавлялась всегда: доступность конкретного торрента по
    // Kitsu id известна только в момент резолва (см. realdebridResolve.ts), и
    // рассуждение было «не найдётся — покажем обычную ошибку». На практике
    // это давало пункт, который у большинства тайтлов просто не работает, —
    // пользователь тыкает в него и получает ошибку вместо видео.
    //
    // Код пути оставлен целиком: включается переменной REALDEBRID_ENABLED=1,
    // если у аккаунта появится рабочая подписка и торренты начнут находиться.
    realdebridTranslations:
      process.env.REALDEBRID_ENABLED === '1'
        ? [{ id: -1, title: 'Real-Debrid', embedUrl: '', source: 'realdebrid' as const }]
        : [],
    skipOpening: yummy?.skipOpening ?? null,
    skipEnding: yummy?.skipEnding ?? null,
    franchiseFallback,
  };
}

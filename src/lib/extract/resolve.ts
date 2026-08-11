import { createServiceClient } from '@/lib/supabase/service';
import { getYummyEpisode } from '@/lib/video/yummy';
import { getKodikOwnPlayerTranslations } from '@/lib/video/kodik';
import { getVideoseedOwnPlayerTranslations } from '@/lib/videoseed-catalog';
import { extractViaVps } from './vpsExtractor';
import type { ExtractSource, ResolvedStream } from './types';

/**
 * Апстрим-ссылки Alloha/Videoseed недолговечны (подписанные/токенизированные
 * URL) — поэтому кэшируем ненадолго, а не «навсегда». См. §12.6
 * ARCHITECTURE.md: извлечение теперь идёт через отдельный VPS-сервис
 * (vps-extractor/) — единственная конфигурация, подтверждённо проходящая
 * антибот источников; клиентское зеркало (mirror) не решило задачу и снято.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

interface Args {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  season: number;
  episode: number;
  source: ExtractSource;
  /** Yummy video_id выбранной озвучки (только anime) — валиден только в
   *  рамках этой серии, см. §12 ARCHITECTURE.md / миграцию 0008. Не задано —
   *  для Alloha VPS сам перебирает кандидатов; для source, которым embedUrl
   *  обязателен (sibnet), извлечение без него вернёт null. */
  translationId?: number;
  /** Пропустить кэш и извлечь заново — для повтора после того, как
   *  закэшированная ссылка уже протухла у апстрима раньше своего TTL
   *  (видел на Videoseed: подписанные CDN-ссылки живут короче 15 минут). */
  forceFresh?: boolean;
  /** Сигнал отмены исходного запроса — прокидывается до extractViaVps, см.
   *  комментарий там. Кэш-хит игнорирует его (быстрый путь, отменять
   *  нечего), важен только на пути реального извлечения. */
  signal?: AbortSignal;
}

/** Резолвит прямую ссылку на видео с кэшированием в Supabase (общий для всех). */
export async function resolveStream({
  contentType,
  shikimoriId,
  season,
  episode,
  source,
  translationId,
  forceFresh,
  signal,
}: Args): Promise<ResolvedStream | null> {
  const supabase = createServiceClient();
  // 0 — слот "без явного выбора озвучки" (старое поведение, VPS сам перебирает).
  const translationSlot = translationId ?? 0;

  if (!forceFresh) {
    const { data: cached } = await supabase
      .from('resolved_streams')
      .select('url, headers, is_hls, is_dash, qualities, subtitles, expires_at')
      .eq('content_type', contentType)
      .eq('shikimori_id', shikimoriId)
      .eq('season', season)
      .eq('episode', episode)
      .eq('source', source)
      .eq('translation_id', translationSlot)
      .maybeSingle();

    if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
      return {
        url: cached.url,
        headers: (cached.headers as Record<string, string>) ?? {},
        isHls: cached.is_hls,
        isDash: cached.is_dash ?? undefined,
        qualities: (cached.qualities as ResolvedStream['qualities']) ?? undefined,
        subtitles: (cached.subtitles as ResolvedStream['subtitles']) ?? undefined,
      };
    }
  }

  // Конкретная озвучка запрошена — находим её embedUrl среди переводов той
  // же серии (тот же список, что уже показывался пользователю в селекторе
  // плеера — см. WatchPlayer/OwnPlayer). Источник списка разный: аниме —
  // Yummy, кино — Kodik/Videoseed по kinopoisk_id (у Yummy кино вообще нет).
  let embedUrl: string | undefined;
  if (translationId != null) {
    if (contentType === 'anime') {
      const yummy = await getYummyEpisode(shikimoriId, episode);
      embedUrl = yummy?.translations.find((t) => t.id === translationId)?.embedUrl;
    } else if (source === 'kodik') {
      const kodik = await getKodikOwnPlayerTranslations(shikimoriId, season, episode);
      embedUrl = kodik.find((t) => t.id === translationId)?.embedUrl;
    } else if (source === 'videoseed') {
      const videoseed = await getVideoseedOwnPlayerTranslations(shikimoriId, season, episode);
      embedUrl = videoseed.find((t) => t.id === translationId)?.embedUrl;
    }
  }

  if (signal?.aborted) return null;
  const resolved = await extractViaVps(source, { shikimoriId, season, episode, embedUrl }, signal);
  if (!resolved) return null;

  await supabase.from('resolved_streams').upsert(
    {
      content_type: contentType,
      shikimori_id: shikimoriId,
      season,
      episode,
      source,
      translation_id: translationSlot,
      url: resolved.url,
      headers: resolved.headers,
      is_hls: resolved.isHls,
      is_dash: resolved.isDash ?? false,
      qualities: resolved.qualities ?? null,
      subtitles: resolved.subtitles ?? null,
      expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    },
    { onConflict: 'content_type,shikimori_id,season,episode,source,translation_id' },
  );

  return resolved;
}

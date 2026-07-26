import { createServiceClient } from '@/lib/supabase/service';
import { extractStream } from './index';
import type { ExtractSource, ResolvedStream } from './types';

/**
 * Апстрим-ссылки Alloha/Videoseed недолговечны (подписанные/токенизированные
 * URL) — поэтому кэшируем ненадолго, а не «навсегда» как раньше file_id в
 * Telegram. Если TTL истёк посреди просмотра, следующий Range-запрос просто
 * заново прогонит Puppeteer (секунда-две паузы) и перезапишет строку — сам
 * плеер это переживёт как обычную буферизацию.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

interface Args {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  season: number;
  episode: number;
  source: ExtractSource;
}

/** Резолвит прямую ссылку на видео с кэшированием в Supabase (общий для всех). */
export async function resolveStream({
  contentType,
  shikimoriId,
  season,
  episode,
  source,
}: Args): Promise<ResolvedStream | null> {
  const supabase = createServiceClient();

  const { data: cached } = await supabase
    .from('resolved_streams')
    .select('url, headers, is_hls, expires_at')
    .eq('content_type', contentType)
    .eq('shikimori_id', shikimoriId)
    .eq('season', season)
    .eq('episode', episode)
    .eq('source', source)
    .maybeSingle();

  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    return {
      url: cached.url,
      headers: (cached.headers as Record<string, string>) ?? {},
      isHls: cached.is_hls,
    };
  }

  const resolved = await extractStream(source, { shikimoriId, season, episode });
  if (!resolved) return null;

  await supabase.from('resolved_streams').upsert(
    {
      content_type: contentType,
      shikimori_id: shikimoriId,
      season,
      episode,
      source,
      url: resolved.url,
      headers: resolved.headers,
      is_hls: resolved.isHls,
      expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    },
    { onConflict: 'content_type,shikimori_id,season,episode,source' },
  );

  return resolved;
}

import { createServiceClient } from '@/lib/supabase/service';
import type { ExtractSource, ResolvedStream } from './types';

/**
 * Апстрим-ссылки Alloha/Videoseed недолговечны (подписанные/токенизированные
 * URL) — поэтому кэшируем ненадолго. Раньше (см. experiment/alloha-tls-
 * fingerprint-spoofing) резолв при кэш-промахе делал Puppeteer прямо здесь;
 * теперь (§12.6 ARCHITECTURE.md) резолвит клиент — сервер только читает
 * кэш (resolveStream) и пишет в него после того, как клиент прислал
 * найденную ссылку (reportResolvedStream).
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

interface Args {
  contentType: 'anime' | 'cinema';
  shikimoriId: number;
  season: number;
  episode: number;
  source: ExtractSource;
}

/** Читает закэшированную прямую ссылку — null, если нет или истёк TTL. */
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
  return null;
}

/** Записывает в кэш ссылку, которую нашёл клиент (см. /api/extract/report). */
export async function reportResolvedStream(
  args: Args & { resolved: ResolvedStream },
): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from('resolved_streams').upsert(
    {
      content_type: args.contentType,
      shikimori_id: args.shikimoriId,
      season: args.season,
      episode: args.episode,
      source: args.source,
      url: args.resolved.url,
      headers: args.resolved.headers,
      is_hls: args.resolved.isHls,
      expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    },
    { onConflict: 'content_type,shikimori_id,season,episode,source' },
  );
}

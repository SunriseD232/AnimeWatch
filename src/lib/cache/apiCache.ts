import { createServiceClient } from '@/lib/supabase/service';

/**
 * Общий (между процессами PM2 cluster_mode) кэш результатов внешних API
 * поверх Supabase, см. миграцию 0019_api_response_cache.sql. В отличие от
 * fetch(..., {next:{revalidate}}) — кэша в памяти ОДНОГО процесса — этот кэш
 * виден всем воркерам сразу, независимо от того, какой из них обработал
 * запрос первым.
 *
 * Ошибки fetcher'а не кэшируются: пишем в базу только успешно вычисленное
 * значение, чтобы временный сбой апстрима не залипал на весь TTL.
 */
export async function getCachedJson<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const supabase = createServiceClient();
  const { data: cached } = await supabase
    .from('api_response_cache')
    .select('response, expires_at')
    .eq('cache_key', cacheKey)
    .maybeSingle();

  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    return cached.response as T;
  }

  const fresh = await fetcher();
  await supabase.from('api_response_cache').upsert(
    {
      cache_key: cacheKey,
      response: fresh as unknown as Record<string, unknown> | null,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    },
    { onConflict: 'cache_key' },
  );
  return fresh;
}

import { getCachedJson } from '@/lib/cache/apiCache';

const KITSU_API = 'https://kitsu.io/api/edge';
const KITSU_TIMEOUT_MS = 8_000;
// Маппинг MAL↔Kitsu статичен (не меняется для существующего тайтла) —
// кэшируем надолго, не как обычные 10-минутные данные каталога.
const MAPPING_TTL_SECONDS = 30 * 24 * 3600;

interface KitsuMappingResponse {
  data?: { relationships?: { item?: { data?: { id?: string } } } }[];
}

/**
 * Shikimori id практически всегда совпадает с MyAnimeList id (Shikimori
 * исторически импортировал нумерацию из MAL — проверено вживую на
 * нескольких тайтлах, включая недавние), но это не гарантия для каждой
 * записи. Резолвим через собственный mapping-API Kitsu (MAL id → Kitsu id),
 * а не жёстко полагаемся на равенство: если для конкретного тайтла id не
 * совпали, просто не найдём маппинг и вкладка AllDebrid для него не
 * появится/не сработает — вместо того чтобы подсунуть чужой тайтл.
 */
export async function getKitsuIdByMalId(malId: number): Promise<number | null> {
  return getCachedJson(`kitsu:mal:${malId}`, MAPPING_TTL_SECONDS, async () => {
    try {
      const params = new URLSearchParams();
      params.set('filter[externalSite]', 'myanimelist/anime');
      params.set('filter[externalId]', String(malId));
      const res = await fetch(`${KITSU_API}/mappings?${params.toString()}`, {
        headers: { Accept: 'application/vnd.api+json' },
        signal: AbortSignal.timeout(KITSU_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as KitsuMappingResponse;
      const kitsuId = data.data?.[0]?.relationships?.item?.data?.id;
      return kitsuId ? Number(kitsuId) : null;
    } catch {
      return null;
    }
  });
}

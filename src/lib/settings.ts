import { createServiceClient } from '@/lib/supabase/service';

/**
 * Настройки, переключаемые вручную из админки (профиль → см.
 * components/RelayToggle.tsx), а не только через .env — сейчас только
 * relay через VPS (см. lib/extract/proxy.ts), но ключ-значение общее для
 * будущих переключателей.
 *
 * Кэш в памяти процесса на короткий TTL: значение читается на КАЖДОМ байт-
 * запросе видео (сегменты HLS/DASH — их может быть много в секунду на
 * пользователя), а не только на смену страницы — поход в Supabase на
 * каждый такой запрос был бы расточительным. TTL короткий (не как у
 * resolved_streams/subtitle_cache) — это живой рубильник, должен
 * применяться быстро после переключения в админке.
 */
const CACHE_TTL_MS = 15_000;

const cache = new Map<string, { value: boolean; expiresAt: number }>();

async function getSetting(key: string, fallback: boolean): Promise<boolean> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  const value = data?.value ?? fallback;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function setSetting(key: string, value: boolean): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  // Инвалидация сразу — не ждать TTL, чтобы админ увидел применение своего
  // же переключения немедленно (на этом же процессе; см. maxAge в API-роуте
  // для мультипроцессной инвалидации — тут её нет, PM2 держит один инстанс).
  cache.delete(key);
}

export function getVpsRelayEnabled(): Promise<boolean> {
  return getSetting('vps_relay_enabled', true);
}

export function setVpsRelayEnabled(enabled: boolean): Promise<void> {
  return setSetting('vps_relay_enabled', enabled);
}

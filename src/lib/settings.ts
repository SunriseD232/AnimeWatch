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
 *
 * ВАЖНО (исправлено 2026-08-26, было сформулировано неверно): PM2 держит
 * ДВА процесса сайта (cluster mode — см. ecosystem.config.js), не один. Кэш
 * — per-process: setSetting() инвалидирует его только в ТОМ процессе,
 * который принял POST /api/admin/relay, второй процесс до 15с продолжал бы
 * отдавать старое значение. Для горячего пути (сам relay в proxy.ts) это не
 * страшно — на решение "проксировать этот сегмент или нет" 15с расхождения
 * между воркерами не влияют на корректность потока. Но именно эта
 * рассинхронизация ломала субъективную "работоспособность" переключателя в
 * админке: обновил страницу профиля сразу после переключения — запрос с
 * заметной вероятностью попадал на ДРУГОЙ воркер и показывал старое
 * значение, выглядело как «настройка не сохраняется» (воспроизведено
 * вживую). Поэтому getVpsRelayEnabled(fresh=true) ниже — отдельный путь в
 * обход кэша для дешёвых admin-only чтений (страница профиля, GET-ручка) —
 * они не стоят на горячем пути (единицы вызовов, не на каждый сегмент), а
 * гарантированная свежесть тут важнее.
 */
const CACHE_TTL_MS = 15_000;

const cache = new Map<string, { value: boolean; expiresAt: number }>();

async function getSetting(key: string, fallback: boolean, fresh = false): Promise<boolean> {
  if (!fresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

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
  // же переключения немедленно НА ЭТОМ ЖЕ процессе. Другой воркер PM2 всё
  // равно об этом не узнает раньше своего TTL — см. большой комментарий у
  // CACHE_TTL_MS выше про то, почему admin-only чтения поэтому идут в обход
  // кэша целиком (fresh=true), а не полагаются на эту инвалидацию.
  cache.delete(key);
}

/** fresh=true — не читать из per-process кэша совсем, только для дешёвых
 *  admin-only чтений (страница профиля, GET-ручка), см. комментарий выше про
 *  рассинхронизацию между двумя процессами PM2. Горячий путь (proxy.ts) не
 *  передаёт fresh — там кэш нужен ради производительности, а секундная
 *  рассинхронизация между воркерами не влияет на корректность. */
export function getVpsRelayEnabled(fresh = false): Promise<boolean> {
  return getSetting('vps_relay_enabled', true, fresh);
}

export function setVpsRelayEnabled(enabled: boolean): Promise<void> {
  return setSetting('vps_relay_enabled', enabled);
}

/** Вкладка «Kodik» в переключателе плеера (см. components/Player.tsx) —
 *  убрана из выбора по умолчанию (см. components/KodikPlayerToggle.tsx в
 *  профиле), но остаётся доступной как рубильник без редеплоя, если
 *  понадобится вернуть. false по умолчанию — именно это и попросили
 *  выключить сразу. */
export function getKodikPlayerEnabled(fresh = false): Promise<boolean> {
  return getSetting('kodik_player_enabled', false, fresh);
}

export function setKodikPlayerEnabled(enabled: boolean): Promise<void> {
  return setSetting('kodik_player_enabled', enabled);
}

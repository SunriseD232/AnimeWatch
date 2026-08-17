import { ProxyAgent } from 'undici';

/**
 * Локальный HTTP-прокси на VPS (Xray-клиент, слушает 127.0.0.1:10809),
 * туннелирующий трафик через VLESS+Reality на внешний сервер. Заведён
 * из-за подтверждённого вживую сетевого ограничения именно этой VPS: любая
 * устойчивая передача байт к CDN премиум-линк-сервисов (проверено на
 * AllDebrid И Real-Debrid — оба упирались в один и тот же порог ~16KB и
 * дальше зависали) обрывается напрямую, но проходит нормально через этот
 * туннель. См. REALDEBRID_HOSTS в lib/extract/proxy.ts — какие именно хосты
 * идут через него.
 *
 * Next.js патчит глобальный fetch — обычный { agent } оттуда не доходит до
 * апстрима (см. историю отладки), поэтому используем dispatcher из undici
 * напрямую, как задокументировано для встроенного fetch в Node.
 */
const VLESS_PROXY_URL = process.env.VLESS_PROXY_URL || 'http://127.0.0.1:10809';

let agent: ProxyAgent | null = null;

export function vlessDispatcher(): ProxyAgent {
  if (!agent) agent = new ProxyAgent(VLESS_PROXY_URL);
  return agent;
}

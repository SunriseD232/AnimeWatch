import { ProxyAgent } from 'undici';

/**
 * Локальный HTTP-прокси на VPS (Xray, слушает 127.0.0.1:10812), который
 * форвардит трафик на RU SOCKS5-прокси Alloha (тот же, что уже используется
 * Puppeteer-извлечением в vps-extractor/src/alloha.js — там браузер умеет
 * SOCKS5 нативно, а undici — нет). Alloha возвращает 404 на /bnsi/ для
 * любого не-российского IP — без прокси даже сам API-запрос с токеном
 * не проходит гео-проверку, проверено вживую.
 *
 * Next.js патчит глобальный fetch — обычный { agent } оттуда не доходит до
 * апстрима (см. vlessProxy.ts), поэтому используем dispatcher из undici.
 */
const ALLOHA_PROXY_URL = process.env.ALLOHA_PROXY_URL || 'http://127.0.0.1:10812';

let agent: ProxyAgent | null = null;

export function allohaDispatcher(): ProxyAgent {
  if (!agent) agent = new ProxyAgent(ALLOHA_PROXY_URL);
  return agent;
}

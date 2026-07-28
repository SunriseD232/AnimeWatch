/**
 * Проверка URL, который клиент утверждает, что нашёл (см. /api/extract/report,
 * §12.6 ARCHITECTURE.md), прежде чем положить его в resolved_streams — это
 * кэш, из которого позже /api/proxy/.../[source] делает СЕРВЕРНЫЙ fetch()
 * (см. fetchAndProxy в proxy.ts). Без проверки эндпоинт превратился бы в
 * SSRF: залогиненный клиент мог бы заставить наш сервер сходить куда угодно,
 * просто "сообщив" произвольный URL.
 *
 * Не формальная гарантия (DNS rebinding между проверкой и последующими
 * fetch()-запросами теоретически возможен), но отсекает очевидные цели:
 * localhost/приватные диапазоны, не-https, пути, не похожие на видео.
 */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fc/i,
  /^\[?fe80/i,
];

export function isSafeUpstreamUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(parsed.hostname))) return false;
  if (!/\.(m3u8|mp4)(\?.*)?$/i.test(parsed.pathname + parsed.search)) return false;
  return true;
}

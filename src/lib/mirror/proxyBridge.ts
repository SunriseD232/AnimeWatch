/**
 * Мост к RU-прокси для серверных fetch() к alloha.yani.tv (см. §12.6
 * ARCHITECTURE.md) — тот же пакет proxy-chain, что раньше поднимал мост для
 * Puppeteer (см. experiment/alloha-tls-fingerprint-spoofing), только теперь
 * потребитель — обычный undici fetch, а не Chromium.
 *
 * Нужен, потому что апстрим-прокси дал только SOCKS5 с логином/паролем
 * (HTTP(S)-порт не отвечал на практике), а undici не умеет авторизованный
 * SOCKS5 напрямую — proxy-chain поднимает локальный анонимный HTTP-мост,
 * который сам форвардит на настоящий SOCKS5-апстрим с учётными данными.
 */

export interface ProxyConfig {
  /** "socks5://host:port" — БЕЗ логина/пароля в самом URL. */
  server: string;
  username?: string;
  password?: string;
}

export interface ResolvedProxy {
  /** Локальный анонимный HTTP-прокси ("http://127.0.0.1:PORT"), без авторизации. */
  localUrl: string;
  /** Останавливает локальный мост. Обязательно вызвать после использования. */
  close: () => Promise<void>;
}

export async function resolveProxy(proxy: ProxyConfig): Promise<ResolvedProxy> {
  const { anonymizeProxy, closeAnonymizedProxy } = await import('proxy-chain');

  const upstream = new URL(proxy.server);
  if (proxy.username) upstream.username = encodeURIComponent(proxy.username);
  if (proxy.password) upstream.password = encodeURIComponent(proxy.password);

  const localUrl = await anonymizeProxy(upstream.toString());
  return {
    localUrl,
    close: () => closeAnonymizedProxy(localUrl, true).then(() => undefined),
  };
}

/** Читает ALLOHA_PROXY_* из окружения — см. .env.example. */
export function getAllohaProxyConfig(): ProxyConfig | undefined {
  const server = process.env.ALLOHA_PROXY_SERVER;
  if (!server) return undefined;
  return {
    server,
    username: process.env.ALLOHA_PROXY_USERNAME,
    password: process.env.ALLOHA_PROXY_PASSWORD,
  };
}

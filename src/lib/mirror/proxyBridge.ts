/**
 * RU-прокси для серверного relay-хопа к alloha.yani.tv — см. §12.6
 * ARCHITECTURE.md, .env.example (ALLOHA_PROXY_*). CycleTLS понимает
 * авторизованный SOCKS5 напрямую (`proxy: "socks5://user:pass@host:port"`)
 * — в отличие от undici/node-wreq, никакого локального анонимизирующего
 * моста (раньше — через пакет proxy-chain) не нужно.
 */
export function getAllohaProxyUrl(): string | undefined {
  const server = process.env.ALLOHA_PROXY_SERVER;
  if (!server) return undefined;

  const username = process.env.ALLOHA_PROXY_USERNAME;
  const password = process.env.ALLOHA_PROXY_PASSWORD;
  if (!username && !password) return server;

  const url = new URL(server);
  if (username) url.username = encodeURIComponent(username);
  if (password) url.password = encodeURIComponent(password);
  return url.toString();
}

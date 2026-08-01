/**
 * Строит абсолютный URL для редиректа (middleware/route handlers). За
 * reverse-proxy (self-host на VPS — см. ARCHITECTURE.md) Next.js не
 * использует Host-заголовок входящего запроса для request.nextUrl/
 * request.url, а падает на свой bind-адрес процесса (0.0.0.0/HOSTNAME) —
 * редиректы вроде /login уезжали на "http://localhost:3000/login" вместо
 * реального домена. `experimental.trustHostHeader` решило бы это, но в
 * используемой версии Next.js это не публичная опция (билд её тихо
 * отбрасывает). SITE_URL — явный публичный адрес, задаём только в проде;
 * без него (локальная разработка) берём origin из самого запроса — там он
 * и так корректен.
 */
export function absoluteUrl(pathname: string, requestUrl: string): URL {
  const base = process.env.SITE_URL || new URL(requestUrl).origin;
  return new URL(pathname, base);
}

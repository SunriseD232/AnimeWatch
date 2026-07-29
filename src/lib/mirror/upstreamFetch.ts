import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { getAllohaProxyConfig, resolveProxy } from './proxyBridge';

/**
 * Локальный HTTP-мост к RU-прокси — один на тёплый инстанс функции (Vercel
 * с Fluid compute переиспользует процесс между вызовами), а не один на
 * запрос: поднимать proxy-chain мост на каждый JS/CSS/API-запрос страницы
 * Alloha было бы заметно медленнее.
 */
let bridgePromise: Promise<{ agent: ProxyAgent } | null> | null = null;

function getBridge(): Promise<{ agent: ProxyAgent } | null> {
  if (bridgePromise) return bridgePromise;
  bridgePromise = (async () => {
    const config = getAllohaProxyConfig();
    if (!config) return null;
    try {
      const resolved = await resolveProxy(config);
      return { agent: new ProxyAgent(resolved.localUrl) };
      // Мост намеренно не закрывается — живёт вместе с warm-инстансом
      // функции; Vercel сам утилизирует процесс при простое.
    } catch (err) {
      console.error('[mirror] resolveProxy() упал, работаем без прокси:', err);
      return null;
    }
  })();
  return bridgePromise;
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Прокидывает запрос апстриму — через RU-прокси, если задан в окружении
 * (см. .env.example, ALLOHA_PROXY_*) И источник его запрашивает
 * (`useProxy` в src/lib/mirror/sources.ts), иначе напрямую. undici.fetch
 * (не глобальный Next-патченный fetch) — следует редиректам по умолчанию и
 * поддерживает ProxyAgent через dispatcher.
 *
 * ⚠️ Пробовали заменить на node-wreq (TLS/JA3-имперсонация конкретного
 * браузера) — см. §12.6 ARCHITECTURE.md: локально решает и антибот Alloha
 * (/bnsi/), и требование Sec-Fetch-Dest у Videoseed, но на самом Vercel
 * стабильно возвращает ответ НАШЕГО ЖЕ приложения (заголовки апстрима
 * содержали `server: Vercel`, `x-matched-path: /login`) вместо настоящего
 * апстрима — похоже на несовместимость нативного Rust-сетевого стека
 * библиотеки с сетевым namespace serverless-песочницы Vercel. Не чинится
 * ни `proxy: false`, ни явными DNS-серверами. Небезопасно (подменяет цель
 * запроса молча) — откачено обратно на undici, который такого не делает
 * (просто не может пройти TLS-фингерпринт-проверку источников, что честный
 * и понятный отказ).
 */
export async function fetchUpstream(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | null;
    useProxy?: boolean;
  } = {},
): Promise<UpstreamResponse> {
  const bridge = init.useProxy ? await getBridge() : null;
  const res = await undiciFetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body ?? undefined,
    dispatcher: bridge?.agent,
  });

  const body = Buffer.from(await res.arrayBuffer());
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return { status: res.status, headers, body };
}

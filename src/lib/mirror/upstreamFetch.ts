import { fetch as wreqFetch } from 'node-wreq';
import { getAllohaProxyConfig, resolveProxy } from './proxyBridge';

/**
 * Локальный HTTP-мост к RU-прокси — один на тёплый инстанс функции (Vercel
 * с Fluid compute переиспользует процесс между вызовами), а не один на
 * запрос: поднимать proxy-chain мост на каждый JS/CSS/API-запрос страницы
 * Alloha было бы заметно медленнее.
 */
let bridgePromise: Promise<string | null> | null = null;

function getBridgeUrl(): Promise<string | null> {
  if (bridgePromise) return bridgePromise;
  bridgePromise = (async () => {
    const config = getAllohaProxyConfig();
    if (!config) return null;
    try {
      const resolved = await resolveProxy(config);
      return resolved.localUrl;
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
 * (`useProxy` в src/lib/mirror/sources.ts), иначе напрямую.
 *
 * node-wreq (не undici/встроенный fetch) — оба источника (§12.6
 * ARCHITECTURE.md) рвут TLS-соединение с обычных HTTP-клиентов (Node
 * `https`, undici, curl — подтверждено экспериментально, не только у нас,
 * но и локально с этой же машины): похоже на TLS/JA3-фингерпринтинг на
 * уровне ClientHello, а не на IP/гео (RU-прокси не помог). node-wreq
 * оборачивает Rust-библиотеку wreq и умеет собирать ClientHello/HTTP2-
 * SETTINGS так, чтобы выглядеть как конкретный настоящий браузер
 * (`browser: 'chrome_147'`) — обычный undici такого не умеет вообще (нет
 * низкоуровневого доступа к TLS-хендшейку из чистого JS/OpenSSL-обвязки).
 *
 * `http1Only: true` — с правильным TLS-отпечатком, но по HTTP/2 у Videoseed
 * стабильно падало с "http2 error: unspecific protocol error" (WAF, похоже,
 * отдельно валидирует HTTP/2-специфику); по HTTP/1.1 то же самое падало на
 * "connection closed before message completed", пока не выяснилось (см.
 * §12.6 ARCHITECTURE.md), что не хватало Sec-Fetch-* заголовков — их
 * ставит сам браузер на настоящей iframe-навигации и наш route.ts просто
 * пересылает как есть, специально ничего добавлять не нужно.
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
  const proxyUrl = init.useProxy ? await getBridgeUrl() : null;
  const res = await wreqFetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body ?? undefined,
    browser: 'chrome_147',
    http1Only: true,
    // Явно false, а не undefined, когда своего прокси нет: node-wreq по
    // умолчанию может подхватывать системные HTTP_PROXY/HTTPS_PROXY —
    // если Vercel выставляет что-то подобное для своих внутренних нужд,
    // это перенаправляло бы наши запросы неизвестно куда.
    proxy: proxyUrl ?? false,
  });

  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers.toObject(), body };
}

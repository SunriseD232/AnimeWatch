import { vlessDispatcher } from '@/lib/net/vlessProxy';

/**
 * Supabase (auth/REST — ubqmltwcfbquenvcxbyl.supabase.co) упирается в тот же
 * сетевой затык этой VPS, что раньше видели на Real-Debrid/AllDebrid —
 * проверено вживую: напрямую с VPS зависает на таймауте (10-15с и обрыв),
 * через VLESS-туннель отвечает мгновенно (~0.4с). supabase-js и
 * @supabase/ssr поддерживают переопределение fetch через global.fetch —
 * передаём его во все серверные клиенты (lib/supabase/server.ts,
 * service.ts, middleware.ts). Браузерный клиент (client.ts) не трогаем —
 * он ходит из браузера пользователя, не с этой VPS, туннель ему не нужен.
 */
export function supabaseFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
    dispatcher: vlessDispatcher(),
  });
}

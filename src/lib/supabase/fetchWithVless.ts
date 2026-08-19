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
 *
 * Свой таймаут — на случай, если сам туннель когда-нибудь застрянет
 * (мост/Xray, а не сам Supabase): без этого supabase-js не ставит
 * собственный AbortSignal, и зависший запрос ничем не ограничен. Не
 * перезаписываем чужой signal, если supabase-js его всё-таки передаст
 * (для своей отмены/ретраев) — комбинируем через AbortSignal.any, как уже
 * сделано в lib/extract/vpsExtractor.ts.
 */
const SUPABASE_FETCH_TIMEOUT_MS = 8_000;

export function supabaseFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, {
    ...init,
    signal,
    // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
    dispatcher: vlessDispatcher(),
  });
}

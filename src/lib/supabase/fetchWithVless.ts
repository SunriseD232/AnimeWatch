/**
 * До миграции 2026-08-21 Supabase был в облаке (ubqmltwcfbquenvcxbyl.
 * supabase.co) и упирался в сетевой затык этой VPS — прямое соединение
 * зависало, через VLESS-туннель отвечало мгновенно. С self-hosted Supabase
 * (supabase.media-watch.ru) это соединение стало ЛИШНИМ хопом до
 * собственного же сервиса на этой VPS: запрос уходил на внешний VLESS-relay
 * и оттуда обратно на публичный IP этой же машины — проверено вживую
 * 2026-08-23: именно так набегали тысячи ConnectTimeoutError/AuthRetryable-
 * FetchError в логах и складывались в периодические зависания сайта у
 * пользователей, раз relay менее надёжен, чем прямой путь до себя же. Убрали
 * dispatcher — обычный fetch со своим таймаутом (см. ниже, зачем он всё
 * равно нужен).
 *
 * supabase-js и @supabase/ssr поддерживают переопределение fetch через
 * global.fetch — передаём его во все серверные клиенты (lib/supabase/
 * server.ts, service.ts, middleware.ts). Браузерный клиент (client.ts) не
 * трогаем — он ходит из браузера пользователя, не с этой VPS.
 *
 * Свой таймаут — без него supabase-js не ставит собственный AbortSignal, и
 * зависший запрос ничем не ограничен. Не перезаписываем чужой signal, если
 * supabase-js его всё-таки передаст (для своей отмены/ретраев) — комбинируем
 * через AbortSignal.any, как уже сделано в lib/extract/vpsExtractor.ts.
 */
const SUPABASE_FETCH_TIMEOUT_MS = 8_000;

export function supabaseFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  // cache: 'no-store' — иначе Next.js складывал ответы базы в свой кэш данных
  // (.next/cache/fetch-cache) и отдавал их снова до следующего деплоя. Ключ
  // кэша — адрес запроса, а у постраничных чтений он одинаковый изо дня в
  // день: крон рейтингов КП/IMDb неделями видел список проверенных тайтлов
  // на момент первого прогона и каждую ночь перекачивал всё заново, крон
  // TMDB — застывший cinema_ratings; туда же попадали resolved_streams и
  // *_index_state (найдено 2026-10-11, 314 ответов Supabase в кэше). Где
  // кэш нужен, он сделан явно (api_response_cache, subtitle_cache).
  return fetch(url, { cache: 'no-store', ...init, signal });
}

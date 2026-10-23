/**
 * Одно вычисление на ключ за раз, плюс короткая память результата в процессе.
 *
 * Зачем. Подсчёт чипов каталога (жанры книг — 1,4 с на 620 тыс. строк) лежит в
 * api_response_cache, но при пустом кэше каждый параллельный запрос считал
 * его сам: одно открытие раздела давало десяток одинаковых тяжёлых запросов,
 * и база переставала успевать отвечать Supabase Auth (24.10.2026). Здесь
 * параллельные вызовы ждут один и тот же промис.
 */
const inflight = new Map<string, Promise<unknown>>();
const memory = new Map<string, { value: unknown; until: number }>();

export function singleFlight<T>(key: string, ttlMs: number, task: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.value as T);
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const promise = task()
    .then((value) => {
      memory.set(key, { value, until: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

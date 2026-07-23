/**
 * Пул воркеров ограниченной параллельности — вместо Promise.all(items.map(fn))
 * (все запросы улетают в один момент, что для внешних API с троттлером даёт
 * всплеск сверх лимита из-за гонки в самом троттлере) и вместо честного
 * последовательного цикла (каждый запрос ждёт сетевую задержку предыдущего
 * поверх лимита скорости — намного медленнее, чем нужно).
 *
 * `limit` воркеров разбирают общую очередь — это держит троттлер API
 * загруженным без пустых промежутков, но без резких всплесков.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

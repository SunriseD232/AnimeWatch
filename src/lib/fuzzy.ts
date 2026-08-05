/** Расстояние Левенштейна — используется для опечаткоустойчивого поиска. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Слово запроса совпадает со словом тайтла, если это его начало (обычный
 * случай) или если оно отличается на 1-2 опечатки — короткие слова (≤4
 * символов) допускают только 1 правку, чтобы не плодить случайные совпадения.
 */
export function wordMatches(queryWord: string, targetWord: string): boolean {
  if (targetWord.startsWith(queryWord)) return true;
  if (queryWord.length < 3) return false;
  const maxDist = queryWord.length <= 4 ? 1 : 2;
  const prefix = targetWord.slice(0, queryWord.length + maxDist);
  return levenshtein(queryWord, prefix) <= maxDist;
}

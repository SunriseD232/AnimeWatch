/**
 * Нормализация названий и сравнение тайтлов между источниками.
 *
 * Маппинг MangaDex <-> Remanga нельзя строить по myanimelist_id: в
 * manga_index (Remanga) такого поля нет. Поэтому сравниваем названия и
 * altTitles и добавляем баллы за год/автора.
 *
 * Без импортов — используется и в клиентобезопасных местах.
 */

/** lower, без диакритики, без пунктуации, одиночные пробелы. */
export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Сходство набора названий с целевыми: 0..1.
 * 0.95 — точное совпадение, 0.55–0.85 — подстрока/токены.
 */
export function titleScore(candidates: string[], targets: string[]): number {
  const normTargets = targets
    .map(normalizeTitle)
    .filter((target) => target.length >= 2);
  if (normTargets.length === 0) return 0;

  let best = 0;

  for (const candidate of candidates) {
    const name = normalizeTitle(candidate);
    if (!name) continue;

    for (const target of normTargets) {
      if (name === target) {
        best = Math.max(best, 0.95);
        continue;
      }

      if (name.includes(target) || target.includes(name)) {
        const shorter = Math.min(name.length, target.length);
        const longer = Math.max(name.length, target.length);
        best = Math.max(best, 0.55 + (shorter / longer) * 0.3);
        continue;
      }

      const a = new Set(name.split(' '));
      const b = new Set(target.split(' '));
      let hit = 0;
      for (const token of a) {
        if (token.length >= 2 && b.has(token)) hit += 1;
      }
      if (hit > 0) {
        best = Math.max(best, 0.4 + (hit / Math.max(a.size, b.size)) * 0.3);
      }
    }
  }

  return Math.min(1, best);
}

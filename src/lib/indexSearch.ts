/**
 * Поиск по словам в индексах подкастов/книг/ранобэ/манги (PostgREST-фильтр).
 *
 * Раньше запрос искался целиком, одной подстрокой: `title ilike '%реализация
 * ии%'`. «ии реализация» или «реализация искусственного…» так не находились,
 * хотя живой поиск источника их находит. Теперь каждое слово должно найтись
 * хотя бы в одной колонке, в любом порядке:
 *
 *   and(or(title.ilike.%w1%,author.ilike.%w1%),or(title.ilike.%w2%,…))
 *
 * Аниме и кино ищут иначе — SQL-функциями с триграммами (0034); здесь
 * без миграции, тем же PostgREST, что и было.
 */

/** Не больше стольких слов: длинный запрос — это уже не поиск по названию. */
const MAX_WORDS = 6;

/** Слова запроса без символов, которые ломают синтаксис or()/and() PostgREST
 *  или работают в ilike как подстановки. */
export function searchWords(query: string): string[] {
  return query
    .replace(/[%_,()"\\*:.]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .slice(0, MAX_WORDS);
}

/** «е» и «ё» — один символ-подстановка `_`: в названиях их пишут как попало. */
function ilikePattern(word: string): string {
  return `%${word.replace(/[её]/gi, '_')}%`;
}

/**
 * Готовая строка для `.or(...)`, или null, если в запросе нет слов.
 * Пример: `q = q.or(filter)`.
 */
export function wordSearchFilter(query: string, columns: string[]): string | null {
  const words = searchWords(query);
  if (words.length === 0) return null;
  const groups = words.map(
    (word) => `or(${columns.map((column) => `${column}.ilike.${ilikePattern(word)}`).join(',')})`,
  );
  // Одна группа — сразу её содержимое; несколько — and() внутри or(), иначе
  // PostgREST не даёт сложить их одним параметром.
  return groups.length === 1
    ? columns.map((column) => `${column}.ilike.${ilikePattern(words[0])}`).join(',')
    : `and(${groups.join(',')})`;
}

/**
 * Жанры и теги каталогов чтения (миграция 0063): из ответа источника — в
 * список названий для manga_index/ranobe_index.genres/tags.
 *
 * Названия, а не id: у Remanga, Renovels и MangaLib свои id, а названия в
 * основном совпадают. Чтобы совпадали и те, что пишутся по-разному только
 * регистром («гг - мужчина» у Renovels, «Гг - мужчина» у других), первая
 * буква — заглавная, лишние пробелы убраны. Остальной регистр не трогаем:
 * «ЛитРПГ» и «ГГ имба» так и пишутся.
 */

/** Не больше стольких названий в одном списке: у части тайтлов Renovels
 *  по 40–60 тегов, а панели фильтров хватает и первых. */
const MAX_NAMES = 60;

export function taxonName(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1) : '';
}

/**
 * `[{id, name}, …]` или `['…', …]` → уникальные названия в порядке
 * источника. undefined — если поля в ответе нет вовсе: тогда строка индекса
 * его не трогает (см. mangaIndexRow), а пустой список значит «у тайтла
 * жанров нет».
 */
export function taxonNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    const raw =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
          ? (item as { name: string }).name
          : null;
    if (!raw) continue;
    const name = taxonName(raw);
    const key = name.toLocaleLowerCase('ru-RU');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_NAMES) break;
  }
  return names;
}

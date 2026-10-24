/**
 * Поиск распознанной речи в тексте книги — этап 2 синхронизации
 * (lib/speechAlign.ts). Чистая функция: без сети, проверяется тестами.
 *
 * Распознавание ошибается в отдельных словах («другом» вместо «другому»,
 * «прятой» вместо «проклятой» — замер 24.10.2026 на «Мастере и Маргарите»),
 * поэтому ищем не точное совпадение, а участок текста, где больше всего
 * слов из распознанного фрагмента. Слова сравниваем по основе (первые
 * STEM букв): окончания распознавание путает чаще всего.
 *
 * Ищем только в окне вокруг оценки этапа 1: во всей книге короткие частые
 * слова дали бы ложные совпадения, а оценка и так ошибается не больше
 * главы.
 */

const STEM = 5;
/** Слова короче — служебные («и», «в», «он»): по ним не ищем. */
const MIN_WORD = 3;
/** Ниже такой доли совпавших слов — не нашли (другой перевод, музыка,
 *  объявление чтеца вместо текста). */
const MIN_SHARE = 0.35;
const MIN_HITS = 5;

interface Word {
  key: string;
  start: number;
  end: number;
}

function words(text: string, base = 0): Word[] {
  const out: Word[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0].toLowerCase().replace(/ё/g, 'е');
    if (raw.length < MIN_WORD) continue;
    out.push({ key: raw.slice(0, STEM), start: base + m.index, end: base + m.index + m[0].length });
  }
  return out;
}

export interface TextMatch {
  /** Символ начала и конца найденного участка в тексте книги. */
  start: number;
  end: number;
  /** Доля слов фрагмента, найденных на участке (0..1). */
  share: number;
}

/**
 * Где в тексте прозвучал фрагмент. approxFraction — оценка этапа 1,
 * windowChars — сколько символов смотреть в каждую сторону от неё.
 */
export function findTranscript(
  text: string,
  transcript: string,
  approxFraction: number,
  windowChars: number,
): TextMatch | null {
  const said = words(transcript);
  if (said.length < MIN_HITS) return null;
  const wanted = new Map<string, number>();
  for (const w of said) wanted.set(w.key, (wanted.get(w.key) ?? 0) + 1);

  const center = Math.round(Math.max(0, Math.min(1, approxFraction)) * text.length);
  const from = Math.max(0, center - windowChars);
  const to = Math.min(text.length, center + windowChars);
  const book = words(text.slice(from, to), from);
  if (book.length === 0) return null;

  // Скользящее окно длиной с фрагмент (с запасом на пропущенные слова):
  // считаем, сколько слов фрагмента в нём есть, не больше, чем их во фрагменте.
  const span = Math.max(said.length, Math.round(said.length * 1.3));
  const counts = new Map<string, number>();
  let hits = 0;
  const add = (key: string) => {
    if (!wanted.has(key)) return;
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    if (c <= (wanted.get(key) ?? 0)) hits++;
  };
  const remove = (key: string) => {
    if (!wanted.has(key)) return;
    const c = counts.get(key) ?? 0;
    if (c <= (wanted.get(key) ?? 0)) hits--;
    counts.set(key, c - 1);
  };

  let best = -1;
  let bestAt = 0;
  for (let i = 0; i < book.length; i++) {
    add(book[i].key);
    if (i >= span) remove(book[i - span].key);
    const startIndex = Math.max(0, i - span + 1);
    // При равенстве — ближе к оценке: соседние абзацы с теми же словами
    // встречаются, а оценка этапа 1 обычно рядом.
    if (
      hits > best ||
      (hits === best && Math.abs(book[startIndex].start - center) < Math.abs(book[bestAt].start - center))
    ) {
      best = hits;
      bestAt = startIndex;
    }
  }

  const share = best / said.length;
  if (best < MIN_HITS || share < MIN_SHARE) return null;

  // Края участка — по первому и последнему совпавшему слову, а не по краям
  // окна: окно с запасом, и без этого конец уезжал бы вперёд.
  const window = book.slice(bestAt, Math.min(book.length, bestAt + span));
  const matched = window.filter((w) => wanted.has(w.key));
  return {
    start: matched[0]?.start ?? window[0].start,
    end: matched[matched.length - 1]?.end ?? window[window.length - 1].end,
    share,
  };
}

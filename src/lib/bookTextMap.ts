import { getCachedJson } from '@/lib/cache/apiCache';
import { fetchBookFile } from '@/lib/books';
import { parseFb2Zip } from '@/lib/fb2';
import type { TextSection } from '@/lib/bookAudioSync';

/**
 * Карта текста книги для синхронизации с аудиокнигой (lib/bookAudioSync.ts):
 * где по доле текста начинается каждая глава, и сам текст — для этапа 2
 * (поиск распознанной фразы).
 *
 * Источник — FB2 той же книги Флибусты: его разбор уже есть (lib/fb2.ts), и
 * текст в нём тот же, что в EPUB (EPUB у Флибусты собран из FB2). Доли
 * считаются по символам текста без разметки — как и epub.js строит карту
 * мест (по объёму текста).
 *
 * Разделы кэшируются на 30 дней: книга не меняется, а скачивание и разбор
 * FB2 — секунды. Текст не кэшируем (сотни килобайт): он нужен только этапу 2
 * и берётся заново — с диска, если книга сохранена, иначе с Флибусты.
 */

const SECTIONS_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface BookText {
  /** Текст без разметки, пробелы схлопнуты. */
  text: string;
  sections: TextSection[];
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Текст и разделы книги; null — файл не пришёл или не разобрался. */
export async function loadBookText(bookId: number): Promise<BookText | null> {
  const file = await fetchBookFile(bookId, 'fb2');
  const parsed = file ? parseFb2Zip(file.body) : null;
  if (!parsed) return null;

  const text = stripTags(parsed.html);
  if (text.trim().length === 0) return null;

  // Начало раздела — длина текста до его открывающего тега <section id=…>.
  const sections: TextSection[] = [];
  for (const chapter of parsed.chapters) {
    const id = chapter.href.replace(/^#/, '');
    const at = parsed.html.indexOf(`<section id="${id}"`);
    if (at < 0) continue;
    const before = stripTags(parsed.html.slice(0, at)).length;
    sections.push({ title: chapter.title, depth: chapter.depth, start: before / text.length });
  }
  return { text, sections };
}

/** Только разделы — для этапа 1, из кэша. Пустой список — карты нет
 *  (синхронизация тогда считает пропорцию по всей книге). */
export async function getBookSections(bookId: number): Promise<TextSection[]> {
  try {
    return await getCachedJson<TextSection[]>(`booksync:sections:${bookId}`, SECTIONS_TTL_SECONDS, async () => {
      const book = await loadBookText(bookId);
      // Бросаем: сбой загрузки не должен лечь в кэш на месяц.
      if (!book) throw new Error(`книга ${bookId}: FB2 не загрузился`);
      return book.sections;
    });
  } catch {
    return [];
  }
}

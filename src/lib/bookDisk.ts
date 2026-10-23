import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import type { BookFormat } from '@/lib/bookShared';

/**
 * Файлы сохранённых книг на диске VPS (миграция 0058).
 *
 * Отдельный модуль, а не часть bookStorage.ts: файл с диска читает
 * fetchBookFile в lib/books.ts, а bookStorage.ts сам пользуется books.ts —
 * общий модуль дал бы циклический импорт.
 *
 * Каталог — рядом с аватарами и обложками (/opt/mediawatch/…), а не внутри
 * сборки: каталоги сборок деплой создаёт и удаляет (scripts/deploy.sh), и
 * книги пропадали бы с каждым релизом.
 */
const BOOK_STORAGE_DIR = process.env.BOOK_STORAGE_DIR ?? '/opt/mediawatch/books';

/** Имя файла на диске. Только числа и известный формат — путь не собрать
 *  из пользовательского ввода. */
export function bookFilePath(bookId: number, format: BookFormat): string {
  return join(BOOK_STORAGE_DIR, `${Math.trunc(bookId)}.${format}`);
}

/** Сохранённый файл или null, если его нет (обычный случай — не ошибка). */
export async function readStoredBookFile(
  bookId: number,
  format: BookFormat,
): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(bookFilePath(bookId, format));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

/**
 * Пишет файл атомарно: сначала во временный, потом rename. Два человека,
 * сохраняющие одну книгу одновременно, не получат полуфайл — каждый
 * переименует свой целый файл поверх, и оба файла одинаковые.
 */
export async function writeStoredBookFile(
  bookId: number,
  format: BookFormat,
  body: ArrayBuffer,
): Promise<void> {
  await mkdir(BOOK_STORAGE_DIR, { recursive: true });
  const target = bookFilePath(bookId, format);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, new Uint8Array(body));
  await rename(tmp, target);
}

export async function removeStoredBookFile(bookId: number, format: BookFormat): Promise<void> {
  await rm(bookFilePath(bookId, format), { force: true });
}

export async function storedBookFileExists(bookId: number, format: BookFormat): Promise<boolean> {
  try {
    return (await stat(bookFilePath(bookId, format))).isFile();
  } catch {
    return false;
  }
}

export interface DiskEntry {
  name: string;
  /** null — не наш файл книги (временный или посторонний). */
  bookId: number | null;
  format: BookFormat | null;
  sizeBytes: number;
  modifiedAt: number;
}

/** Всё, что лежит в каталоге, — для уборки сирот кроном. */
export async function listStoredBookFiles(): Promise<DiskEntry[]> {
  let names: string[];
  try {
    names = await readdir(BOOK_STORAGE_DIR);
  } catch {
    return [];
  }

  const entries: DiskEntry[] = [];
  for (const name of names) {
    try {
      const info = await stat(join(BOOK_STORAGE_DIR, name));
      if (!info.isFile()) continue;
      const match = name.match(/^(\d+)\.(epub|fb2)$/);
      entries.push({
        name,
        bookId: match ? Number(match[1]) : null,
        format: match ? (match[2] as BookFormat) : null,
        sizeBytes: info.size,
        modifiedAt: info.mtimeMs,
      });
    } catch {
      /* файл исчез между readdir и stat — пропускаем */
    }
  }
  return entries;
}

/** Удалить посторонний/временный файл по имени из listStoredBookFiles. */
export async function removeStoredEntry(name: string): Promise<void> {
  if (name.includes('/') || name.includes('\\') || name.startsWith('.')) return;
  await rm(join(BOOK_STORAGE_DIR, name), { force: true });
}

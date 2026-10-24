import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { createServiceClient } from '@/lib/supabase/service';
import type { BookFormat } from '@/lib/bookShared';

/**
 * Кэш файлов книг на диске VPS (24.10.2026, миграция 0067): каждая открытая
 * книга и запас популярных (крон prefetch-books) лежат у нас, и при сбое
 * Флибусты они открываются. 24.10.2026 Флибуста лежала целиком, а на диске
 * не было ни одной книги — не открывалось ничего.
 *
 * Отдельно от «сохранённых на сервере» (lib/bookDisk.ts, /opt/mediawatch/
 * books): там файлы живут, пока их держит пользователь, и ночная чистка
 * удаляет всё, что не сохранено. Здесь — общий кэш с лимитом размера:
 * переполнился — уходят книги, которые дольше всех не открывали (время
 * доступа — mtime файла, его обновляет каждое чтение).
 *
 * Что лежит в кэше, знает и база: book_index.local_formats. По ней — значок
 * «есть на сервере» и фильтр каталога; обновляется при записи и вытеснении.
 */

const CACHE_DIR = process.env.BOOK_CACHE_DIR ?? '/opt/mediawatch/book-cache';
const MAX_BYTES = Math.max(1, Number(process.env.BOOK_CACHE_MAX_GB ?? 10)) * 1024 ** 3;
/** Вытесняем до этой доли лимита — чтобы не чистить на каждой записи. */
const LOW_WATER = 0.9;

function cachePath(bookId: number, format: BookFormat): string {
  return join(CACHE_DIR, `${Math.trunc(bookId)}.${format}`);
}

export async function readCachedBookFile(bookId: number, format: BookFormat): Promise<ArrayBuffer | null> {
  const path = cachePath(bookId, format);
  try {
    const buf = await readFile(path);
    // Отметка «открывали» — для вытеснения давно не нужного.
    const now = new Date();
    await utimes(path, now, now).catch(() => undefined);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function cachedBookFormats(bookId: number): Promise<BookFormat[]> {
  const out: BookFormat[] = [];
  for (const format of ['epub', 'fb2'] as BookFormat[]) {
    try {
      if ((await stat(cachePath(bookId, format))).isFile()) out.push(format);
    } catch {
      // нет файла
    }
  }
  return out;
}

async function setLocalFormats(bookId: number): Promise<void> {
  const formats = await cachedBookFormats(bookId);
  await createServiceClient().from('book_index').update({ local_formats: formats }).eq('book_id', bookId);
}

/** Положить файл в кэш (атомарно: через временный файл) и, если кэш
 *  разросся, вытеснить давно не открытое. Ошибки не роняют чтение книги. */
export async function writeCachedBookFile(bookId: number, format: BookFormat, body: ArrayBuffer): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const target = cachePath(bookId, format);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, new Uint8Array(body));
    await rename(tmp, target);
    await setLocalFormats(bookId);
    await evictIfNeeded();
  } catch (err) {
    console.error(`[bookCache] ${bookId}.${format} не записался:`, err instanceof Error ? err.message : err);
  }
}

export interface BookCacheStats {
  files: number;
  bytes: number;
  maxBytes: number;
}

async function entries(): Promise<{ name: string; size: number; mtime: number }[]> {
  let names: string[];
  try {
    names = await readdir(CACHE_DIR);
  } catch {
    return [];
  }
  const out: { name: string; size: number; mtime: number }[] = [];
  for (const name of names) {
    if (!/^\d+\.(epub|fb2)$/.test(name)) continue;
    try {
      const info = await stat(join(CACHE_DIR, name));
      out.push({ name, size: info.size, mtime: info.mtimeMs });
    } catch {
      // исчез между readdir и stat
    }
  }
  return out;
}

export async function bookCacheStats(): Promise<BookCacheStats> {
  const list = await entries();
  return { files: list.length, bytes: list.reduce((s, e) => s + e.size, 0), maxBytes: MAX_BYTES };
}

/** Есть ли место для запаса: крон останавливается, когда кэш почти полон,
 *  чтобы не вытеснять им книги, которые люди открывали сами. */
export async function bookCacheHasRoom(): Promise<boolean> {
  const { bytes } = await bookCacheStats();
  return bytes < MAX_BYTES * LOW_WATER * 0.9;
}

async function evictIfNeeded(): Promise<void> {
  const list = await entries();
  let total = list.reduce((s, e) => s + e.size, 0);
  if (total <= MAX_BYTES) return;
  list.sort((a, b) => a.mtime - b.mtime);
  const touched = new Set<number>();
  for (const entry of list) {
    if (total <= MAX_BYTES * LOW_WATER) break;
    await rm(join(CACHE_DIR, entry.name), { force: true });
    total -= entry.size;
    touched.add(Number(entry.name.split('.')[0]));
  }
  for (const bookId of touched) await setLocalFormats(bookId).catch(() => undefined);
}

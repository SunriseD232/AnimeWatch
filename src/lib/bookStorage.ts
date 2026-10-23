import { createServiceClient } from '@/lib/supabase/service';
import { fetchBookFile } from '@/lib/books';
import {
  listStoredBookFiles,
  removeStoredBookFile,
  removeStoredEntry,
  storedBookFileExists,
  writeStoredBookFile,
} from '@/lib/bookDisk';
import {
  MAX_SAVED_BOOKS,
  SAVED_BOOK_FINISHED_PERCENT,
  savedBookExpiresAt,
  type BookFormat,
  type SavedBook,
} from '@/lib/bookShared';

/**
 * Книги, сохранённые на сервере (миграция 0058). Server-only: service_role.
 *
 * Модель — ссылки на общие файлы. user_saved_books говорит «кто что
 * сохранил», book_files — «что лежит на диске». Одна книга на диске одна,
 * сколько бы человек её ни сохранили; файл живёт, пока на него ссылается хоть
 * одна строка (плюс сутки после последней — см. FILE_GRACE_MS).
 *
 * Отдаёт файл с диска fetchBookFile (lib/books.ts) — любому вошедшему, кто
 * открыл эту книгу, а не только сохранившему: это тот же самый файл, и
 * качать его второй раз с Флибусты незачем. Сроки хранения считаются только
 * по тем, кто книгу сохранил.
 */

const MB = 1024 * 1024;

/** Потолок одного файла. EPUB/FB2 обычно 0,3–2 МБ; FB2 с иллюстрациями
 *  бывает 20–30 МБ. Больше — почти наверняка не книга или не нужно. */
const MAX_FILE_BYTES = envMb('BOOK_STORAGE_MAX_FILE_MB', 50) * MB;

/** Общий потолок хранилища. На диске VPS ~15 ГБ свободно (23.10.2026);
 *  10 книг × 2 формата × ~1 МБ — ~20 МБ на человека, 2 ГБ хватит с запасом.
 *  Упёрлись — новые сохранения не принимаются; чужие книги ради них НЕ
 *  вытесняются. */
const MAX_TOTAL_BYTES = envMb('BOOK_STORAGE_MAX_MB', 2048) * MB;

/** Сколько живёт файл без ссылок. Если книгу тут же сохранят снова, не
 *  придётся качать её с Флибусты (которая к тому времени может лечь). */
const FILE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Временный файл старше часа — обрывок упавшей записи. */
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

const FORMATS: BookFormat[] = ['epub', 'fb2'];

function envMb(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export type SaveBookResult =
  | { ok: true; formats: BookFormat[]; alreadySaved: boolean; count: number }
  | { ok: false; reason: 'limit' | 'quota' | 'source' | 'too_large' | 'error'; message: string };

export interface SaveBookInput {
  bookId: number;
  title: string;
  author: string | null;
  coverUrl: string | null;
  /** Форматы, которые перечислила Флибуста. FB2 пробуем, только если он там есть. */
  formats: BookFormat[];
}

async function countSaved(userId: string): Promise<number> {
  const { count } = await createServiceClient()
    .from('user_saved_books')
    .select('book_id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

async function totalStoredBytes(): Promise<number> {
  const { data } = await createServiceClient().from('book_files').select('size_bytes');
  return (data ?? []).reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0);
}

/**
 * Положить один формат на диск, если его там ещё нет. Возвращает причину
 * отказа или null при успехе.
 */
async function ensureFile(
  bookId: number,
  format: BookFormat,
): Promise<null | 'quota' | 'source' | 'too_large'> {
  const supabase = createServiceClient();

  const { data: known } = await supabase
    .from('book_files')
    .select('size_bytes')
    .eq('book_id', bookId)
    .eq('format', format)
    .maybeSingle();

  if (known && (await storedBookFileExists(bookId, format))) {
    // Уже лежит (сохранил кто-то другой). Снимаем «без ссылок», если крон
    // успел его так пометить.
    await supabase
      .from('book_files')
      .update({ unreferenced_since: null })
      .eq('book_id', bookId)
      .eq('format', format);
    return null;
  }

  // Флибусту дёргаем только когда понятно, что файл есть куда положить.
  if ((await totalStoredBytes()) >= MAX_TOTAL_BYTES) return 'quota';

  // fetchBookFile сначала смотрит на диск, но файла там нет — значит, идёт
  // к Флибусте и проверяет, что пришла книга, а не HTML-заглушка.
  const file = await fetchBookFile(bookId, format);
  if (!file) return 'source';
  if (file.body.byteLength > MAX_FILE_BYTES) return 'too_large';
  if ((await totalStoredBytes()) + file.body.byteLength > MAX_TOTAL_BYTES) return 'quota';

  await writeStoredBookFile(bookId, format, file.body);
  const { error } = await supabase.from('book_files').upsert(
    {
      book_id: bookId,
      format,
      size_bytes: file.body.byteLength,
      stored_at: new Date().toISOString(),
      unreferenced_since: null,
    },
    { onConflict: 'book_id,format' },
  );
  if (error) throw new Error(`book_files: ${error.message}`);
  return null;
}

/**
 * Сохранить книгу для человека. Порядок важен: сначала дешёвые проверки
 * (уже сохранена? лимит?), потом скачивание, и только потом строка в базе —
 * иначе человек увидел бы «сохранено», а файла бы не было.
 */
export async function saveBookForUser(userId: string, input: SaveBookInput): Promise<SaveBookResult> {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('user_saved_books')
    .select('formats')
    .eq('user_id', userId)
    .eq('book_id', input.bookId)
    .maybeSingle();
  if (existing) {
    return {
      ok: true,
      formats: (existing.formats ?? []) as BookFormat[],
      alreadySaved: true,
      count: await countSaved(userId),
    };
  }

  if ((await countSaved(userId)) >= MAX_SAVED_BOOKS) {
    return {
      ok: false,
      reason: 'limit',
      message: `На сервере уже ${MAX_SAVED_BOOKS} ваших книг. Уберите одну, чтобы сохранить эту.`,
    };
  }

  // EPUB — основной читатель, FB2 — запасной. Конвертер Флибусты делает
  // EPUB почти из всего, поэтому пробуем его всегда; FB2 — если он есть.
  const wanted = FORMATS.filter((f) => f === 'epub' || input.formats.includes(f));
  const saved: BookFormat[] = [];
  let lastFailure: 'quota' | 'source' | 'too_large' = 'source';


  // Форматы — параллельно: nginx ждёт ответа 90 сек (proxy_read_timeout),
  // а по очереди два файла с повторами по зеркалам могли бы занять больше.
  // Тогда человек увидел бы ошибку, хотя книга бы сохранилась.
  const results = await Promise.all(
    wanted.map(async (format) => {
      try {
        return { format, failure: await ensureFile(input.bookId, format) };
      } catch (err) {
        console.error(
          `[bookStorage] ${input.bookId}.${format} не сохранился:`,
          err instanceof Error ? err.message : err,
        );
        return { format, failure: 'source' as const };
      }
    }),
  );
  for (const { format, failure } of results) {
    if (failure) lastFailure = failure;
    else saved.push(format);
  }

  if (saved.length === 0) {
    const messages = {
      quota: 'Хранилище книг на сервере заполнено. Попробуйте позже.',
      source: 'Флибуста сейчас не отдаёт файл этой книги. Попробуйте позже.',
      too_large: 'Файл книги слишком большой для хранения на сервере.',
    } as const;
    return { ok: false, reason: lastFailure, message: messages[lastFailure] };
  }

  const { error } = await supabase.from('user_saved_books').insert({
    user_id: userId,
    book_id: input.bookId,
    title: input.title,
    author: input.author,
    cover_url: input.coverUrl,
    formats: saved,
  });

  if (error) {
    // Триггер лимита: параллельное сохранение успело занять десятое место.
    // Скачанный файл не удаляем — без ссылок его уберёт крон через сутки.
    if (error.message.includes('saved_books_limit')) {
      return {
        ok: false,
        reason: 'limit',
        message: `На сервере уже ${MAX_SAVED_BOOKS} ваших книг. Уберите одну, чтобы сохранить эту.`,
      };
    }
    // Двойной клик: строка уже есть — это успех, а не ошибка.
    if (error.code === '23505') {
      return { ok: true, formats: saved, alreadySaved: true, count: await countSaved(userId) };
    }
    console.error('[bookStorage] user_saved_books:', error.message);
    return { ok: false, reason: 'error', message: 'Не получилось сохранить книгу. Попробуйте ещё раз.' };
  }

  return { ok: true, formats: saved, alreadySaved: false, count: await countSaved(userId) };
}

/**
 * Убрать книгу из сохранённых. Файл сразу не трогаем: на него могут
 * ссылаться другие, а решать это — дело крона (см. cleanupSavedBooks).
 */
export async function removeSavedBook(userId: string, bookId: number): Promise<void> {
  const { error } = await createServiceClient()
    .from('user_saved_books')
    .delete()
    .eq('user_id', userId)
    .eq('book_id', bookId);
  if (error) throw new Error(error.message);
}

interface SavedRow {
  user_id: string;
  book_id: number;
  title: string;
  author: string | null;
  cover_url: string | null;
  formats: string[] | null;
  saved_at: string;
}

interface ProgressRow {
  user_id: string;
  shikimori_id: number;
  updated_at: string;
  progress_percent: number | null;
}

/** Последняя активность и «дочитана ли» — по saved_at и прогрессу чтения.
 *  Отдельной отметки «открывал» нет: читатель и так пишет прогресс при
 *  открытии и при каждом перелистывании (lib/readingProgress.ts). */
function toSavedBook(row: SavedRow, progress: ProgressRow | undefined): SavedBook {
  const savedAt = row.saved_at;
  const lastActivityAt =
    progress && progress.updated_at > savedAt ? progress.updated_at : savedAt;
  const finished = (progress?.progress_percent ?? 0) >= SAVED_BOOK_FINISHED_PERCENT;
  return {
    bookId: Number(row.book_id),
    title: row.title,
    author: row.author,
    coverUrl: row.cover_url,
    formats: (row.formats ?? []).filter((f): f is BookFormat => f === 'epub' || f === 'fb2'),
    savedAt,
    lastActivityAt,
    expiresAt: savedBookExpiresAt(lastActivityAt, finished),
    finished,
  };
}

async function progressFor(rows: SavedRow[]): Promise<Map<string, ProgressRow>> {
  const result = new Map<string, ProgressRow>();
  if (rows.length === 0) return result;

  const ids = Array.from(new Set(rows.map((row) => Number(row.book_id))));
  const users = Array.from(new Set(rows.map((row) => row.user_id)));
  const { data } = await createServiceClient()
    .from('watch_progress')
    .select('user_id, shikimori_id, updated_at, progress_percent')
    .eq('content_type', 'book')
    .in('shikimori_id', ids)
    .in('user_id', users);

  for (const row of (data ?? []) as ProgressRow[]) {
    result.set(`${row.user_id}:${Number(row.shikimori_id)}`, row);
  }
  return result;
}

/** Сохранённые книги человека, свежие сверху. */
export async function listSavedBooks(userId: string): Promise<SavedBook[]> {
  try {
    const { data } = await createServiceClient()
      .from('user_saved_books')
      .select('*')
      .eq('user_id', userId)
      .order('saved_at', { ascending: false });
    const rows = (data ?? []) as SavedRow[];
    const progress = await progressFor(rows);
    return rows.map((row) => toSavedBook(row, progress.get(`${row.user_id}:${Number(row.book_id)}`)));
  } catch {
    // Миграция 0058 не применена или база недоступна — блок просто не
    // показывается, страница книг работает как раньше.
    return [];
  }
}

export interface CleanupResult {
  expiredRemoved: number;
  filesDeleted: number;
  filesRefetched: number;
  orphansDeleted: number;
  filesCount: number;
  bytesTotal: number;
}

/**
 * Ночная уборка. Порядок:
 *   1. Снять с хранения просроченные сохранения (90 дней без чтения,
 *      дочитанные — 30). Человеку это видно заранее: на странице книг у
 *      каждой сохранённой стоит «хранится до …».
 *   2. Файлы без ссылок пометить, а помеченные больше суток — удалить.
 *   3. Файл, на который ссылаются, но которого нет на диске (диск чистили
 *      руками, переезд), — скачать заново, если Флибуста отвечает.
 *   4. Удалить с диска то, чего нет в book_files: обрывки .tmp и сироты.
 */
export async function cleanupSavedBooks(): Promise<CleanupResult> {
  const supabase = createServiceClient();
  const now = Date.now();
  const result: CleanupResult = {
    expiredRemoved: 0,
    filesDeleted: 0,
    filesRefetched: 0,
    orphansDeleted: 0,
    filesCount: 0,
    bytesTotal: 0,
  };

  // ── 1. Просроченные сохранения ──
  const { data: savedData, error: savedError } = await supabase
    .from('user_saved_books')
    .select('*');
  if (savedError) throw new Error(`user_saved_books: ${savedError.message}`);
  const savedRows = (savedData ?? []) as SavedRow[];
  const progress = await progressFor(savedRows);

  const alive: SavedRow[] = [];
  for (const row of savedRows) {
    const book = toSavedBook(row, progress.get(`${row.user_id}:${Number(row.book_id)}`));
    if (new Date(book.expiresAt).getTime() > now) {
      alive.push(row);
      continue;
    }
    const { error } = await supabase
      .from('user_saved_books')
      .delete()
      .eq('user_id', row.user_id)
      .eq('book_id', row.book_id);
    if (error) {
      console.error('[bookStorage] не снял просроченную книгу:', error.message);
      alive.push(row);
    } else {
      result.expiredRemoved += 1;
    }
  }

  const referenced = new Set<string>();
  for (const row of alive) {
    for (const format of row.formats ?? []) referenced.add(`${Number(row.book_id)}:${format}`);
  }

  // ── 2–3. Файлы по таблице ──
  const { data: filesData, error: filesError } = await supabase.from('book_files').select('*');
  if (filesError) throw new Error(`book_files: ${filesError.message}`);

  const known = new Set<string>();
  for (const file of filesData ?? []) {
    const bookId = Number(file.book_id);
    const format = file.format as BookFormat;
    const key = `${bookId}:${format}`;
    const isReferenced = referenced.has(key);
    const onDisk = await storedBookFileExists(bookId, format);

    if (!isReferenced) {
      const since = file.unreferenced_since ? new Date(file.unreferenced_since).getTime() : null;
      if (since == null) {
        await supabase
          .from('book_files')
          .update({ unreferenced_since: new Date(now).toISOString() })
          .eq('book_id', bookId)
          .eq('format', format);
        if (onDisk) {
          known.add(key);
          result.filesCount += 1;
          result.bytesTotal += Number(file.size_bytes);
        }
        continue;
      }
      if (now - since >= FILE_GRACE_MS) {
        await removeStoredBookFile(bookId, format);
        await supabase.from('book_files').delete().eq('book_id', bookId).eq('format', format);
        result.filesDeleted += 1;
        continue;
      }
    } else if (file.unreferenced_since) {
      await supabase
        .from('book_files')
        .update({ unreferenced_since: null })
        .eq('book_id', bookId)
        .eq('format', format);
    }

    if (!onDisk) {
      // Строка есть, файла нет. Нужен кому-то — пробуем скачать снова; не
      // вышло или не нужен — убираем строку: пусть таблица говорит правду.
      const fresh = isReferenced ? await fetchBookFile(bookId, format).catch(() => null) : null;
      if (fresh && fresh.body.byteLength <= MAX_FILE_BYTES) {
        await writeStoredBookFile(bookId, format, fresh.body);
        await supabase
          .from('book_files')
          .update({ size_bytes: fresh.body.byteLength, stored_at: new Date().toISOString() })
          .eq('book_id', bookId)
          .eq('format', format);
        result.filesRefetched += 1;
        known.add(key);
        result.filesCount += 1;
        result.bytesTotal += fresh.body.byteLength;
      } else {
        await supabase.from('book_files').delete().eq('book_id', bookId).eq('format', format);
      }
      continue;
    }

    known.add(key);
    result.filesCount += 1;
    result.bytesTotal += Number(file.size_bytes);
  }

  // ── 4. Сироты на диске ──
  for (const entry of await listStoredBookFiles()) {
    const isOurs = entry.bookId != null && entry.format != null;
    if (isOurs && known.has(`${entry.bookId}:${entry.format}`)) continue;
    // Свежий .tmp — запись идёт прямо сейчас, не трогаем.
    if (!isOurs && now - entry.modifiedAt < TMP_MAX_AGE_MS) continue;
    // Наш файл без строки, но свежий — сохранение между записью файла и
    // upsert в book_files. Тоже ждём.
    if (isOurs && now - entry.modifiedAt < TMP_MAX_AGE_MS) continue;
    await removeStoredEntry(entry.name);
    result.orphansDeleted += 1;
  }

  return result;
}

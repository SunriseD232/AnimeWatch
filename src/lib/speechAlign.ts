import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { audioToTextFraction, textFractionToAudio, type AudioPosition } from '@/lib/bookAudioSync';
import { loadBookText, type BookText } from '@/lib/bookTextMap';
import { findTranscript } from '@/lib/textMatch';
import type { AudiobookChapter } from '@/lib/audiobookShared';

/**
 * Синхронизация книги и аудиокниги — этап 2: точное место по речи.
 *
 * Этап 1 (lib/bookAudioSync.ts) даёт оценку с ошибкой в пределах главы.
 * Здесь берём 25 секунд записи вокруг оценки, распознаём их whisper.cpp и
 * ищем фразу в тексте книги рядом с оценкой (lib/textMatch.ts). Нашли —
 * место точное до фразы; не нашли (другой перевод, музыка) — остаётся
 * оценка этапа 1, и об этом честно говорим.
 *
 * Ресурсы VPS (2 ядра, замер 24.10.2026): вырезка 25–30 с из mp3 по ссылке
 * ~3 с, распознавание моделью base ~13 с и ~300 МБ памяти. Поэтому:
 *   • по одному фрагменту за раз (очередь), с пониженным приоритетом (nice);
 *   • больше QUEUE_LIMIT ожидающих — сразу «занято», а не очередь на минуты;
 *   • только по запросу человека, ничего заранее.
 * Бинарник и модель — /opt/whisper.cpp (собраны на VPS; пути — в env
 * WHISPER_BIN / WHISPER_MODEL). Их нет (локальная сборка) — этап 2 честно
 * недоступен, этап 1 работает.
 */

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_BIN ?? '/opt/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? '/opt/whisper.cpp/models/ggml-base.bin';
const SNIPPET_SECONDS = 25;
const QUEUE_LIMIT = 3;
/** Окно поиска фразы вокруг оценки: ±4 % книги, но не меньше 15 тыс.
 *  символов — оценка этапа 1 ошибается не больше главы. */
const WINDOW_SHARE = 0.04;
const WINDOW_MIN_CHARS = 15_000;
/** Книги в памяти: человек обычно уточняет одну и ту же книгу несколько
 *  раз подряд, а скачивание и разбор FB2 — секунды. */
const BOOK_CACHE_SIZE = 3;

export function speechAlignAvailable(): boolean {
  return existsSync(WHISPER_BIN) && existsSync(WHISPER_MODEL);
}

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

/** Одна задача за раз; переполнено — null сразу. */
async function exclusive<T>(task: () => Promise<T>): Promise<T | null> {
  if (waiting >= QUEUE_LIMIT) return null;
  waiting++;
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  try {
    return await run;
  } finally {
    waiting--;
  }
}

const bookCache = new Map<number, BookText>();

async function bookText(bookId: number): Promise<BookText | null> {
  const cached = bookCache.get(bookId);
  if (cached) return cached;
  const loaded = await loadBookText(bookId);
  if (!loaded) return null;
  bookCache.set(bookId, loaded);
  while (bookCache.size > BOOK_CACHE_SIZE) {
    const oldest = bookCache.keys().next().value;
    if (oldest === undefined) break;
    bookCache.delete(oldest);
  }
  return loaded;
}

/** Только mp3 с knigavuhe: ссылка уходит в ffmpeg, и чужой адрес (в том
 *  числе внутренний) туда попасть не должен. */
function safeAudioUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'knigavuhe.org' || parsed.hostname.endsWith('.knigavuhe.org'));
  } catch {
    return false;
  }
}

/** Распознанный текст фрагмента части с секунды start. */
async function transcribe(url: string, start: number): Promise<string | null> {
  if (!safeAudioUrl(url)) return null;
  const wav = path.join(tmpdir(), `mw-sync-${randomUUID()}.wav`);
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-nostdin', '-loglevel', 'error', '-y',
        '-ss', String(Math.max(0, Math.floor(start))),
        '-t', String(SNIPPET_SECONDS),
        '-i', url,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        wav,
      ],
      { timeout: 30_000 },
    );
    const { stdout } = await execFileAsync(
      'nice',
      ['-n', '10', WHISPER_BIN, '-m', WHISPER_MODEL, '-l', 'ru', '-t', '2', '-nt', '-np', '-f', wav],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const text = stdout.replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error('[speechAlign] распознавание:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await unlink(wav).catch(() => undefined);
  }
}

function windowChars(textLength: number): number {
  return Math.max(WINDOW_MIN_CHARS, Math.round(textLength * WINDOW_SHARE));
}

export type AlignResult<T> =
  | { status: 'refined'; value: T }
  | { status: 'not_found' | 'busy' | 'unavailable' };

/**
 * Книга → запись: доля текста → точная секунда. Фрагмент берём с чуть более
 * раннего места, чем оценка, находим, где в тексте он начался, и сдвигаем
 * время на разницу по темпу этого же фрагмента (символов в секунду).
 */
export async function refineToAudio(
  chapters: AudiobookChapter[],
  bookId: number,
  fraction: number,
): Promise<AlignResult<AudioPosition>> {
  if (!speechAlignAvailable()) return { status: 'unavailable' };
  const result = await exclusive(async (): Promise<AlignResult<AudioPosition>> => {
    const book = await bookText(bookId);
    if (!book) return { status: 'not_found' };
    const total = book.text.length;
    const estimate = textFractionToAudio(chapters, fraction, book.sections, 10);
    const chapter = chapters[estimate.chapterIndex - 1];
    if (!chapter) return { status: 'not_found' };

    const heard = await transcribe(chapter.url, estimate.position);
    if (!heard) return { status: 'not_found' };
    const match = findTranscript(book.text, heard, fraction, windowChars(total));
    if (!match) return { status: 'not_found' };

    // Темп чтеца по этому же фрагменту; сдвиг от начала фрагмента до цели.
    const charsPerSecond = Math.max(5, (match.end - match.start) / SNIPPET_SECONDS);
    const shift = (fraction * total - match.start) / charsPerSecond;
    let position = estimate.position + shift - 3;
    // Цель могла оказаться в соседней части — пересчитываем через общую ось.
    let chapterIndex = estimate.chapterIndex;
    while (position < 0 && chapterIndex > 1) {
      chapterIndex--;
      position += chapters[chapterIndex - 1].durationSeconds;
    }
    while (chapterIndex < chapters.length && position > chapters[chapterIndex - 1].durationSeconds) {
      position -= chapters[chapterIndex - 1].durationSeconds;
      chapterIndex++;
    }
    return { status: 'refined', value: { chapterIndex, position: Math.max(0, Math.floor(position)) } };
  });
  return result ?? { status: 'busy' };
}

/**
 * Запись → книга: место в записи → точная доля текста. Распознаём то, что
 * прозвучало ПЕРЕД местом остановки, и берём конец найденной фразы.
 */
export async function refineToBook(
  chapters: AudiobookChapter[],
  bookId: number,
  position: AudioPosition,
): Promise<AlignResult<number>> {
  if (!speechAlignAvailable()) return { status: 'unavailable' };
  const result = await exclusive(async (): Promise<AlignResult<number>> => {
    const book = await bookText(bookId);
    if (!book) return { status: 'not_found' };
    const chapter = chapters[Math.min(Math.max(1, position.chapterIndex), chapters.length) - 1];
    if (!chapter) return { status: 'not_found' };

    const estimate = audioToTextFraction(chapters, position, book.sections);
    const heard = await transcribe(chapter.url, Math.max(0, position.position - SNIPPET_SECONDS));
    if (!heard) return { status: 'not_found' };
    const match = findTranscript(book.text, heard, estimate, windowChars(book.text.length));
    if (!match) return { status: 'not_found' };
    return { status: 'refined', value: Math.max(0, Math.min(1, match.end / book.text.length)) };
  });
  return result ?? { status: 'busy' };
}

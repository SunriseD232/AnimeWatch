import { createClient } from '@/lib/supabase/server';
import { getAudiobookDetails } from '@/lib/audiobooks';
import { getBookSections } from '@/lib/bookTextMap';
import { audioToTextFraction, textFractionToAudio } from '@/lib/bookAudioSync';
import { formatTime } from '@/lib/format';
import { DRAMA_GENRE, type AudiobookDetails } from '@/lib/audiobookShared';
import type { WatchProgress } from '@/lib/types';

/**
 * Предложения «продолжить с места из книги / из аудиокниги» (этап 1,
 * lib/bookAudioSync.ts). Считает сервер при открытии плеера или читалки.
 *
 * Правило: главнее то, что свежее, а не то, что дальше. Человек мог
 * вернуться перечитать начало — тогда тащить его вперёд было бы ошибкой.
 * И мы не прыгаем молча: место — оценка, поэтому показываем предложение,
 * а решает человек.
 */

/** Расхождение меньше этого — предлагать нечего, места и так совпадают. */
const SAME_PLACE_FRACTION = 0.005;
/** Аудиоспектакль — инсценировка, а не чтение текста: синхронизации нет. */
function isDrama(audiobook: { genres: string[] }): boolean {
  return audiobook.genres.includes(DRAMA_GENRE);
}

/** Доля текста из прогресса книги: FB2 пишет её в locator.textFraction,
 *  EPUB — в progress_percent (epub.js считает по объёму текста). */
export function bookTextFraction(progress: WatchProgress | null): number | null {
  if (!progress) return null;
  const locator = progress.locator && typeof progress.locator === 'object' ? progress.locator : null;
  const fromLocator = Number(locator?.textFraction);
  if (Number.isFinite(fromLocator)) return Math.max(0, Math.min(1, fromLocator));
  if (progress.progress_percent != null) return Math.max(0, Math.min(1, progress.progress_percent));
  const scroll = Number(locator?.scrollPercent);
  return Number.isFinite(scroll) ? Math.max(0, Math.min(1, scroll)) : null;
}

/** ?from= из адреса читалки: доля 0..1, иначе null. */
export function parseSyncFraction(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function newer(a: WatchProgress | null, b: WatchProgress | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return new Date(a.updated_at).getTime() > new Date(b.updated_at).getTime();
}

function percentText(fraction: number): string {
  return `${Math.max(1, Math.round(fraction * 100))} %`;
}

async function progressRow(type: 'book' | 'audiobook', id: number): Promise<WatchProgress | null> {
  const { data } = await createClient()
    .from('watch_progress')
    .select('*')
    .eq('content_type', type)
    .eq('shikimori_id', id)
    .maybeSingle();
  return (data as WatchProgress | null) ?? null;
}

export interface AudioOffer {
  text: string;
  chapterIndex: number;
  position: number;
  /** Для этапа 2 (уточнение): с какой доли текста считали. */
  fraction: number;
}

/**
 * Плеер аудиокниги: книга прочитана дальше по времени — предложить место.
 * Вызывать только для вошедшего пользователя (RLS отдаёт его строки).
 */
export async function getAudioOffer(
  audiobook: AudiobookDetails,
  audioProgress: WatchProgress | null,
): Promise<AudioOffer | null> {
  if (!audiobook.bookId || isDrama(audiobook) || audiobook.chapters.length === 0) return null;
  try {
    const bookProgress = await progressRow('book', audiobook.bookId);
    const fraction = bookTextFraction(bookProgress);
    if (fraction == null || fraction < 0.01 || !newer(bookProgress, audioProgress)) return null;

    const sections = await getBookSections(audiobook.bookId);
    const parts = audiobook.chapters;
    if (audioProgress) {
      const heard = audioToTextFraction(
        parts,
        { chapterIndex: audioProgress.episode, position: audioProgress.position_seconds ?? 0 },
        sections,
      );
      if (Math.abs(heard - fraction) < SAME_PLACE_FRACTION) return null;
    }
    const target = textFractionToAudio(parts, fraction, sections);
    return {
      text: `В книге вы остановились на ${percentText(fraction)} — продолжить с части ${target.chapterIndex}, ${formatTime(target.position)}?`,
      chapterIndex: target.chapterIndex,
      position: target.position,
      fraction,
    };
  } catch {
    return null;
  }
}

export interface BookOffer {
  text: string;
  /** Доля текста, с которой открыть книгу (оценка этапа 1). */
  fraction: number;
  audiobookId: number;
  /** Место в записи — для уточнения по речи (этап 2). */
  chapterIndex: number;
  position: number;
}

/**
 * Читалка книги: какая-то её озвучка прослушана позже, чем книга читалась, —
 * предложить открыть книгу с этого места.
 */
export async function getBookOffer(bookId: number, bookProgress: WatchProgress | null): Promise<BookOffer | null> {
  try {
    const supabase = createClient();
    const { data: narrations } = await supabase
      .from('audiobook_index')
      .select('id')
      .eq('book_id', bookId)
      .limit(50);
    const ids = ((narrations ?? []) as { id: number }[]).map((row) => Number(row.id));
    if (ids.length === 0) return null;

    const { data } = await supabase
      .from('watch_progress')
      .select('*')
      .eq('content_type', 'audiobook')
      .in('shikimori_id', ids)
      .order('updated_at', { ascending: false })
      .limit(1);
    const audioProgress = ((data ?? []) as WatchProgress[])[0] ?? null;
    if (!audioProgress || !newer(audioProgress, bookProgress)) return null;

    const audiobook = await getAudiobookDetails(audioProgress.shikimori_id);
    if (!audiobook || isDrama(audiobook) || audiobook.chapters.length === 0) return null;

    const sections = await getBookSections(bookId);
    const fraction = audioToTextFraction(
      audiobook.chapters,
      { chapterIndex: audioProgress.episode, position: audioProgress.position_seconds ?? 0 },
      sections,
    );
    const read = bookTextFraction(bookProgress);
    if (fraction < 0.01 || (read != null && Math.abs(read - fraction) < SAME_PLACE_FRACTION)) return null;

    const reader = audiobook.readers[0] ? ` (читает ${audiobook.readers[0]})` : '';
    return {
      text: `В аудиокниге${reader} вы дослушали примерно до ${percentText(fraction)} книги — открыть с этого места?`,
      fraction,
      audiobookId: audiobook.id,
      chapterIndex: audioProgress.episode,
      position: Math.floor(audioProgress.position_seconds ?? 0),
    };
  } catch {
    return null;
  }
}

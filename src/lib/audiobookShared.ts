/**
 * Типы и ссылки аудиокниг (knigavuhe.org, миграция 0064). Client-safe: без
 * серверных импортов — им пользуются и страницы, и плеер.
 */

export interface AudiobookSummary {
  /** id knigavuhe. Он же shikimori_id в watch_progress (content_type 'audiobook'). */
  id: number;
  /** knigavuhe.org/book/{slug}/ — по нему открывается страница с главами. */
  slug: string;
  title: string;
  authors: string[];
  readers: string[];
  genres: string[];
  annotation: string | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  views: number | null;
  likes: number | null;
  /** Пара во Флибусте (book_index) — для синхронизации места и ссылки на текст. */
  bookId: number | null;
}

export interface AudiobookChapter {
  /** 1..N — номер в списке; он же episode в watch_progress. */
  index: number;
  title: string;
  /** Прямая ссылка на mp3 у knigavuhe: браузер берёт звук оттуда сам. */
  url: string;
  /** Подписанная ссылка через наш прокси — запасной путь, если прямая не
   *  загрузилась (сеть пользователя, блокировка). */
  fallbackUrl: string;
  durationSeconds: number;
}

export interface AudiobookDetails extends AudiobookSummary {
  chapters: AudiobookChapter[];
  /** Аннотация целиком (в индексе — обрезанная). */
  description: string | null;
}

/** Жанр knigavuhe, у которого текст записи — не текст книги: синхронизацию
 *  с книгой для него не предлагаем. */
export const DRAMA_GENRE = 'Аудиоспектакли';

export function audiobookHref(id: number): string {
  return `/audiobooks/${id}`;
}

/** «9 ч 18 мин», «42 мин». */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${Math.max(1, minutes)} мин`;
  return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

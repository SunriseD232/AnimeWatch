import type { ContentType, WatchProgress } from '@/lib/types';

/**
 * Ссылки и подписи для строки из watch_progress / watched_episodes /
 * user_list любого типа. Client-safe: без серверных импортов.
 *
 * Зачем. Профиль, админка, публичный профиль и уведомления писались, когда
 * типов было два, и решали «кино или аниме» тернарником: всё, что не
 * 'cinema', становилось аниме. После подкастов, книг, ранобэ и манги такая
 * строка вела на /anime/<id> — то есть на чужое аниме с тем же числом
 * (id у Remanga, Apple и Shikimori — разные пространства).
 */

/** Карточка тайтла. У манги и ранобэ адрес по слагу, а в строках только
 *  числовой id — поэтому через /…/id/[id], который найдёт слаг в индексе. */
export function contentTitleHref(type: ContentType, id: number): string {
  switch (type) {
    case 'cinema':
      return `/cinema/${id}`;
    case 'podcast':
      return `/podcasts/${id}`;
    case 'book':
      return `/books/${id}`;
    case 'manga':
      return `/manga/id/${id}`;
    case 'ranobe':
      return `/ranobe/id/${id}`;
    case 'audiobook':
      return `/audiobooks/${id}`;
    default:
      return `/anime/${id}`;
  }
}

/** Куда ведёт «продолжить» для строки прогресса. */
export function contentResumeHref(progress: WatchProgress): string {
  const id = progress.shikimori_id;
  const locator = progress.locator && typeof progress.locator === 'object' ? progress.locator : null;
  const dir = typeof locator?.dir === 'string' ? locator.dir : null;

  switch (progress.content_type) {
    case 'cinema':
      return `/cinema/watch/${id}/${progress.season ?? 1}/${progress.episode}`;
    case 'podcast':
      return `/podcasts/listen/${id}/${progress.episode}`;
    case 'book':
      return `/books/read/${id}`;
    case 'audiobook':
      // Плеер на странице книги сам продолжит с сохранённой главы и места.
      return `/audiobooks/${id}`;
    case 'manga': {
      // Канонический idx (каноническая ось) важнее старого chapterId Remanga.
      const key = Number(locator?.idx ?? locator?.chapterId);
      return dir && Number.isFinite(key) && key > 0
        ? `/manga/read/${encodeURIComponent(dir)}/${key}`
        : contentTitleHref('manga', id);
    }
    case 'ranobe': {
      const chapterId = Number(locator?.chapterId);
      return dir && Number.isFinite(chapterId) && chapterId > 0
        ? `/ranobe/read/${encodeURIComponent(dir)}/${chapterId}`
        : contentTitleHref('ranobe', id);
    }
    default:
      return `/watch/${id}/${progress.episode}`;
  }
}

/** «Серия 5», «Выпуск 12», «Глава 30» — подпись юнита для истории/прогресса. */
export function contentUnitLabel(type: ContentType, season: number, episode: number): string {
  switch (type) {
    case 'podcast':
      return `Выпуск ${episode}`;
    case 'manga':
    case 'ranobe':
      return `Глава ${episode}`;
    case 'book':
      // В историю книга попадает, только когда дочитана (lib/readingProgress.ts).
      return 'Прочитана';
    case 'audiobook':
      return `Часть ${episode}`;
    default:
      return `${season > 1 ? `Сезон ${season}, ` : ''}Серия ${episode}`;
  }
}

/** Короткое название раздела — метка рядом с названием в смешанных списках. */
export function contentTypeLabel(type: ContentType): string {
  switch (type) {
    case 'cinema':
      return 'Кино';
    case 'podcast':
      return 'Подкаст';
    case 'book':
      return 'Книга';
    case 'manga':
      return 'Манга';
    case 'ranobe':
      return 'Ранобэ';
    case 'audiobook':
      return 'Аудиокнига';
    default:
      return 'Аниме';
  }
}

/** Ключ нашей копии обложки (poster_cache) — она есть только у аниме и кино.
 *  null — не искать: у Remanga id 350 и аниме 350 — разные тайтлы. */
export function localPosterKey(type: ContentType, id: number): string | null {
  return type === 'anime' || type === 'cinema' ? `${type}:${id}` : null;
}

/** Процент для полоски прогресса: у видео и звука — по секундам, у чтения —
 *  progress_percent. null — показать нечего. */
export function contentProgressPercent(progress: WatchProgress): number | null {
  if (progress.unit && progress.unit !== 'seconds') {
    return progress.progress_percent != null
      ? Math.round(Math.max(0, Math.min(1, progress.progress_percent)) * 100)
      : null;
  }
  const { position_seconds: pos, duration_seconds: dur } = progress;
  if (!dur || dur <= 0 || pos == null) return null;
  return Math.round(Math.max(0, Math.min(1, pos / dur)) * 100);
}

/** Текст уведомления о приросте: «Новая глава — теперь их 31». */
export function newUnitText(type: ContentType, total: number): string {
  switch (type) {
    case 'manga':
    case 'ranobe':
      return `Новая глава — теперь их ${total}`;
    case 'podcast':
      return `Новый выпуск — теперь их ${total}`;
    default:
      return `Новая серия — теперь их ${total}`;
  }
}

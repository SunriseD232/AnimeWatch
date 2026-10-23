import type { ContentSource } from '@/lib/types';

/**
 * Сохранение прогресса чтения — общее для EPUB-читателя (epub.js),
 * FB2-читателя, ранобэ и манги.
 *
 * Почему отдельный модуль, а не хук useProgressSaver. Тот заточен под видео:
 * секунды, серии, отправка по таймеру воспроизведения. У книги позиция —
 * это CFI/проценты, и писать её нужно по другому поводу (перелистнули
 * страницу, прокрутили текст). Механика запроса та же, поэтому здесь только
 * тонкая обёртка над /api/progress — без импортов из серверных модулей.
 */

export interface ReadingProgressArgs {
  /** id книги/ранобэ/манги у источника; уходит в shikimori_id. */
  id: number;
  title: string;
  coverUrl: string | null;
  /** Источник ('flibusta' | 'renovels' | 'remanga'). */
  source: ContentSource;
  /** Доля прочитанного 0..1 (у ранобэ/манги — от всего тайтла). */
  percent: number;
  /** Место, которое не влезает в число: cfi epub.js, chapterId, scrollPercent. */
  locator: Record<string, unknown>;
  /**
   * Тип контента. По умолчанию 'book' — так этот модуль и появился; ранобэ
   * передаёт 'ranobe', манга — 'manga'.
   */
  contentType?: 'book' | 'ranobe' | 'manga';
  /**
   * Единица позиции. У книги — 'percent', у ранобэ — 'chapter', у манги —
   * 'page' (глава/страница плюс доля прокрутки). Сервер хранит
   * progress_percent для всех трёх (см. /api/progress), поэтому
   * «продолжить» показывает общий процент.
   */
  unit?: 'percent' | 'chapter' | 'page';
  /** Номер главы для ранобэ/манги; у книги всегда 1. */
  episode?: number;
}

/** Глава долистана до этой доли — она прочитана (уходит в историю). */
const CHAPTER_READ_AT = 0.95;
/** Книга прочитана с этой доли: последние страницы — часто примечания. */
const BOOK_READ_AT = 0.98;

/** Что уже отмечено в этой вкладке: отметка уходит один раз, а не с
 *  каждым сохранением позиции у конца главы. После перезагрузки страницы
 *  повтор безвреден — сервер делает upsert. */
const marked = new Set<string>();

/**
 * Прочитана ли глава/книга по этому сохранению — для истории
 * (watched_episodes) и статуса «Прочитано» в списке (user_list), как у
 * видео: досмотренная серия уходит в историю, последняя — в «Просмотрено».
 *   • книга — доля ≥ 98 %: и в историю, и «Прочитано»;
 *   • глава ранобэ/манги — долистана до 95 %: в историю; если это последняя
 *     глава тайтла — ещё и «Прочитано».
 */
function readFlags(args: ReadingProgressArgs, episode: number, percent: number) {
  const type = args.contentType ?? 'book';
  let read = false;
  let lastUnit = false;

  if (type === 'book') {
    read = percent >= BOOK_READ_AT;
    lastUnit = true;
  } else {
    const scroll = Number(args.locator.scrollPercent);
    const total = Number(args.locator.chaptersCount);
    read = Number.isFinite(scroll) && scroll >= CHAPTER_READ_AT;
    lastUnit = Number.isFinite(total) && total > 0 && episode >= total;
  }
  if (!read) return {};

  const key = `${type}:${args.id}:${episode}`;
  if (marked.has(key)) return {};
  marked.add(key);
  return { watched_episode: true, ...(lastUnit ? { completed: true } : {}) };
}

/**
 * Отправляет прогресс и НЕ ждёт ответа. keepalive — чтобы запрос пережил
 * закрытие вкладки: последняя страница сохраняется как раз в этот момент.
 * Ошибку глотаем: потеря одной отметки не повод показывать пользователю
 * ошибку поверх книги.
 */
export function saveReadingProgress(args: ReadingProgressArgs): void {
  const percent = Math.max(0, Math.min(1, Number.isFinite(args.percent) ? args.percent : 0));
  const episode =
    Number.isFinite(args.episode) && (args.episode as number) > 0
      ? Math.trunc(args.episode as number)
      : 1;

  try {
    void fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        content_type: args.contentType ?? 'book',
        shikimori_id: args.id,
        // У книги нет серий: «эпизод» всегда 1. У ранобэ и манги — номер
        // главы: поле обязано быть числом, по нему строится unique-ключ.
        season: 1,
        episode,
        position_seconds: 0,
        anime_title: args.title,
        poster_url: args.coverUrl,
        source: args.source,
        unit: args.unit ?? 'percent',
        progress_percent: percent,
        locator: args.locator,
        ...readFlags(args, episode, percent),
      }),
    }).catch(() => {});
  } catch {
    // fetch может бросить синхронно (например, в очень старом WebView).
  }
}

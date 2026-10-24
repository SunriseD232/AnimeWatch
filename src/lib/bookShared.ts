/**
 * Мелочи книг, которые нужны и серверу, и браузеру: форма карточки, формат
 * файла и подписи.
 *
 * Вынесены из lib/books.ts по той же причине, что shikimoriShared и
 * podcastShared: карточка книги и читатель — клиентские компоненты, а
 * lib/books.ts ходит в сеть (Флибуста) и в базу. Пока они импортировали
 * константы прямо оттуда, в клиентский бандл ехал весь модуль целиком, и
 * сборка падала с webpack-ошибкой на next/headers.
 *
 * Здесь зависимостей нет вовсе — и не должно появиться.
 */

/**
 * Источник книг. Сейчас один — Флибуста (OPDS). Отдельным полем, а не
 * константой в коде: у ReManga/Renovels тоже есть книги и свои числовые id,
 * и при добавлении второго источника старые строки прогресса должны остаться
 * понятными (см. колонку source, миграция 0053).
 */
export type BookSource = 'flibusta';

/**
 * Формат файла. EPUB — основной: Флибуста отдаёт его готовым (конвертирует на
 * лету из fb2), а у нас его читает epub.js с точным CFI.
 * FB2 — запасной: есть книги, которые в epub не конвертируются. Читается
 * серверным парсером (fb2 → HTML), см. lib/fb2.ts.
 */
export type BookFormat = 'epub' | 'fb2';

/** Формат по умолчанию — почти все книги читаются как EPUB. */
export const DEFAULT_BOOK_FORMAT: BookFormat = 'epub';

/** Карточка книги — то, что нужно сетке и карточке. */
export interface BookSummary {
  /** id Флибусты (число из ссылки /b/{id}/...). Он же shikimori_id прогресса. */
  id: number;
  title: string;
  author: string;
  /** Аннотация (может отсутствовать — Флибуста отдаёт её не у всех). */
  annotation: string | null;
  /** Жанры (у OPDS-поиска обычно один, у карточки — несколько). */
  genres: string[];
  /** Форматы, доступные у источника. */
  formats: BookFormat[];
  language: string | null;
  /** Размер файла в байтах, если источник его сообщил. */
  sizeBytes: number | null;
  /** Число скачиваний — Флибуста отдаёт в описании; сортировка «популярное». */
  downloads: number | null;
  year: number | null;
  /** Прямая ссылка на страницу книги у источника (для «открыть на Флибусте»). */
  sourceUrl: string;
  /**
   * Обложка. У Флибусты она есть не у всех записей (в OPDS-поиске часто нет,
   * в лентах новинок/жанров — почти всегда). Ссылка уже подписана и ведёт на
   * наш /api/proxy/raw: оригинал — тяжёлый PNG (300–700 КБ), а прокси умеет
   * ресайзить по `?w=`. null — карточка покажет заглушку с первой буквой.
   */
  coverUrl: string | null;
  /** Файл лежит на нашем сервере (кэш, миграция 0067): откроется, даже если
   *  Флибуста недоступна. undefined — неизвестно (живой поиск OPDS). */
  offline?: boolean;
}

export interface BookDetails extends BookSummary {
  /** Оглавление из EPUB (или из FB2) — плоский список с вложенностью по depth. */
  chapters: BookChapter[];
  /** Пусто — не удалось получить файл; страница скажет об этом прямо. */
  chaptersUnavailable: boolean;
}

/** Глава/раздел оглавления. Для чтения достаточно epub.js внутреннего TOC. */
export interface BookChapter {
  /** Уровень вложенности (0 — верхний). */
  depth: number;
  title: string;
  /** href внутри EPUB (относительный). У FB2 — синтетический. */
  href: string;
}

export function bookSourceLabel(source: BookSource): string {
  switch (source) {
    case 'flibusta':
      return 'Флибуста';
  }
}

/** Цвет/подпись формата — в карточке и в кнопках скачивания. */
export const BOOK_FORMAT_LABEL: Record<BookFormat, string> = {
  epub: 'EPUB',
  fb2: 'FB2',
};

// ─────────────────────────── Книги, сохранённые на сервере ───────────────────────────
// Миграция 0058. Константы здесь, а не в lib/bookStorage.ts: их показывает
// интерфейс («3 из 10», «удалится 12.01»), а тот модуль серверный.

/** Сколько книг человек может держать на сервере. Тот же лимит стоит
 *  триггером в базе (enforce_saved_books_limit) — менять оба места. */
export const MAX_SAVED_BOOKS = 10;

/** Сохранённую книгу, которую не открывали столько дней, крон убирает сам. */
export const SAVED_BOOK_IDLE_DAYS = 90;

/** Дочитанную (≥ 98 %) — раньше: место нужнее тем, кто читает сейчас. */
export const SAVED_BOOK_FINISHED_IDLE_DAYS = 30;

/** Доля, с которой книга считается дочитанной. */
export const SAVED_BOOK_FINISHED_PERCENT = 0.98;

export interface SavedBook {
  bookId: number;
  title: string;
  author: string | null;
  coverUrl: string | null;
  formats: BookFormat[];
  savedAt: string;
  /** Последнее чтение: позже из saved_at и обновления прогресса. */
  lastActivityAt: string;
  /** Когда крон уберёт книгу, если её не открывать. */
  expiresAt: string;
  finished: boolean;
}

/** Срок хранения по последней активности — одна формула для крона и UI. */
export function savedBookExpiresAt(lastActivityAt: string, finished: boolean): string {
  const days = finished ? SAVED_BOOK_FINISHED_IDLE_DAYS : SAVED_BOOK_IDLE_DAYS;
  return new Date(new Date(lastActivityAt).getTime() + days * 86_400_000).toISOString();
}

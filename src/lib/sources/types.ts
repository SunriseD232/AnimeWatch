/**
 * Слой источников чтения: типы и контракт адаптера.
 *
 * Здесь НЕТ импортов — файл должен оставаться безопасным для клиентских
 * компонентов. Серверные адаптеры импортируют типы отсюда, а не наоборот.
 */

/** Типы контента, которые читаются через источники. */
export type ReadingContentType = 'manga' | 'ranobe' | 'book';

/** Источники чтения. Порядок приоритета задаётся в registry.ts. */
export type SourceId =
  | 'remanga'
  | 'mangadex'
  | 'mangalib'
  | 'selfmanga'
  | 'mintmanga'
  | 'yai'
  | 'renovels'
  | 'flibusta';

export type SourceKind = 'manga' | 'ranobe' | 'book';

/** Ключ тайтла: id источника-каталога, а НЕ Shikimori id. */
export interface SourceTitleKey {
  contentType: ReadingContentType;
  /** id Remanga / Renovels / Флибусты (= shikimori_id прогресса). */
  titleKey: number;
  title: string;
  altTitles?: string[];
  year?: number;
}

/** Найденный тайтл в источнике. */
export interface SourceMatch {
  source: SourceId;
  externalId: string;
  /** Вариант внутри источника: язык, группа перевода, том. */
  variant: string;
  title: string;
  /** Уверенность маппинга 0..1. */
  confidence: number;
  chaptersCount?: number;
  language?: string;
  externalUrl?: string;
}

/** Глава у конкретного источника (не каноническая). */
export interface SourceChapter {
  source: SourceId;
  /** int, uuid или slug у источника. */
  chapterKey: string;
  /** Номер главы: 21.2. null — если источник не отдал. */
  chapterNo: number | null;
  /** Том, если источник его различает. Нужен, чтобы «том 2, глава 1» не
   *  слился с «том 1, глава 1». */
  tome?: number | null;
  label: string;
  isPaid: boolean;
  isFreeToday: boolean;
  pagesCount?: number;
}

/** Одна страница-картинка. */
export interface ResolvedPage {
  url: string;
  width?: number;
  height?: number;
}

/**
 * Контент главы. Дискриминированный union: манга — картинки, ранобэ — HTML,
 * Флибуста — EPUB. Так нельзя случайно вернуть «страницы» там, где их нет.
 */
export type ResolvedContent =
  | { format: 'images'; pages: ResolvedPage[] }
  | { format: 'html'; html: string }
  | { format: 'epub'; url: string };

/** Контракт адаптера источника. */
export interface SourceAdapter {
  id: SourceId;
  kind: SourceKind;
  /**
   * Гранулярность: 'chapter' — обычные главы; 'volume' — том (Флибуста).
   * Резолвер не включает тома в каноническое оглавление.
   */
  granularity?: 'chapter' | 'volume';
  /** Включён ли источник (env-флаг + health). */
  isEnabled(): boolean;
  /** Найти тайтл в источнике. */
  findByTitle(input: SourceTitleKey): Promise<SourceMatch | null>;
  /** Список глав. Для granularity='volume' может вернуть []. */
  listChapters(match: SourceMatch): Promise<SourceChapter[]>;
  /** Контент одной главы. Платную главу не запрашиваем. */
  getChapter(match: SourceMatch, chapterKey: string): Promise<ResolvedContent | null>;
}

/** Доступность канонической главы в источнике. */
export interface ChapterSourceRef {
  source: SourceId;
  variant: string;
  chapterKey: string;
  isPaid: boolean;
  isFreeToday: boolean;
  pagesCount?: number;
}

/** Каноническая глава тайтла. */
export interface CanonicalChapter {
  /** Порядковый номер 1..N; уходит в watch_progress.episode. */
  idx: number;
  /** Номер главы: 21.2. */
  chapterNo: number | null;
  /** Том, если различается. */
  tome?: number | null;
  label: string;
  sources: ChapterSourceRef[];
}

/** Результат выбора источника для конкретной главы. */
export type ResolveChapterResult =
  | {
      ok: true;
      source: SourceId;
      variant: string;
      chapterKey: string;
      content: ResolvedContent;
    }
  | { ok: false; reason: 'paid' | 'not-found' | 'unavailable' };

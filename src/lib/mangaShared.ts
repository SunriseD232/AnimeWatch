/**
 * Манга: мелкие типы и подписи, общие для сервера и браузера.
 *
 * Лежат отдельно от lib/manga.ts по той же причине, что ranobeShared: карточка
 * и читатель — клиентские компоненты, а серверный модуль ходит в сеть и в
 * Supabase. Если импортировать типы прямо оттуда, в клиентский бандл поедет
 * весь модуль и сборка упадёт на next/headers.
 *
 * Здесь нет ни одного импорта — и не должно появиться.
 */

/** Источник манги. Пока один — Remanga. */
export type MangaSource = 'remanga';

/** Карточка манги — то, что нужно сетке каталога и карточке тайтла. */
export interface MangaSummary {
  /** id тайтла у Remanga. Он же shikimori_id прогресса. */
  id: number;
  /** Слаг для /manga/{dir}; по нему же источник отдаёт карточку. */
  dir: string;
  title: string;
  /** Оригинальное/английское название — для поиска и подписи под заголовком. */
  originalTitle: string | null;
  /** Третье название (another_name у Remanga) — только для поиска. */
  alternativeTitle: string | null;
  /** Тип у источника: «Манга», «Манхва», «Маньхуа», «Руманга». */
  kind: string | null;
  status: string | null;
  year: number | null;
  rating: number | null;
  votes: number | null;
  views: number | null;
  chaptersCount: number | null;
  /** Подписанная ссылка на обложку (или прямая, если секрет не задан). */
  coverUrl: string | null;
  /** Страница тайтла у источника — только для атрибуции. */
  sourceUrl: string;
  /** Жанры и теги — для фильтров каталога (миграция 0063). undefined —
   *  источник их в этом ответе не прислал (живой поиск), а не «их нет». */
  genres?: string[];
  tags?: string[];
}

/** Полная карточка: то, что даёт живой /api/titles/{dir}/. */
export interface MangaDetails extends MangaSummary {
  /** Описание без HTML: в карточке показываем обычным текстом. */
  description: string | null;
  genres: string[];
  categories: string[];
  /** Ветка (издание/перевод), по которой запрашивается список глав. */
  branchId: number | null;
  /** Первая глава, если источник её отдал, — для кнопки «Начать читать». */
  firstChapterId: number | null;
  /** false — живой API не ответил, показана запись из нашего индекса. */
  sourceAvailable: boolean;
}

/** Глава в оглавлении. */
export interface MangaChapter {
  id: number;
  /** Порядковый номер в выдаче (1..N). В progress уходит как episode. */
  index: number;
  tome: number;
  /** Номер главы у источника: «1», «1.1», «0». */
  number: string;
  /** Название главы; часто пустое. */
  name: string;
  /** Платная глава: страницы недоступны без покупки у источника. */
  isPaid: boolean;
  /** Платная, но сегодня открыта источником бесплатно. */
  isFreeToday: boolean;
  /** Можно ли открыть читатель: бесплатная или бесплатная сегодня. */
  isReadable: boolean;
  /** Готовая подпись: «Том 2, глава 1.1 — Название». */
  label: string;
  /**
   * Короткие метки источников, где глава доступна (RM, MD, …).
   * Заполняется только в каноническом режиме; у Remanga-оглавления пусто.
   */
  sourceLabels?: string[];
}

/** Одна страница-картинка главы. */
export interface MangaPage {
  /** Уже подписанная ссылка через /api/proxy/raw (или прямая). */
  url: string;
  width: number | null;
  height: number | null;
}

/** Страницы одной главы. */
export interface MangaChapterContent {
  id: number;
  titleId: number;
  index: number;
  tome: number;
  number: string;
  name: string;
  isPaid: boolean;
  isFreeToday: boolean;
  pages: MangaPage[];
  hasPages: boolean;
}

/** Ссылка на карточку тайтла. */
export function mangaTitleHref(dir: string): string {
  return `/manga/${encodeURIComponent(dir)}`;
}

/** Ссылка на читатель конкретной главы. */
export function mangaReadHref(dir: string, chapterId: number): string {
  return `/manga/read/${encodeURIComponent(dir)}/${chapterId}`;
}

/**
 * Подпись главы. Remanga отдаёт номер строкой («0», «1.1»), том отдельно,
 * а название — не всегда. «Глава 0» выглядит странно, поэтому нулевую главу
 * называем прологом.
 */
export function formatMangaChapterLabel(chapter: {
  index: number;
  tome: number;
  number: string;
  name: string;
}): string {
  const number = chapter.number.trim();
  const base = !number || number === '0' ? 'Пролог' : `Глава ${number}`;
  const tome = chapter.tome > 1 ? `Том ${chapter.tome}, ` : '';
  const name = chapter.name.trim();
  // У Remanga name часто повторяет номер («Глава 1»), а иногда продолжает
  // его («Глава 1. Начало»). В первом случае не дублируем, во втором берём
  // name целиком — иначе получилось бы «Глава 1 — Глава 1. Начало».
  const tail = !name
    ? base
    : name === base || name.startsWith(base)
      ? name
      : `${base} — ${name}`;
  return `${tome}${tail}`;
}

/** Короткая подпись для строки «продолжить» и шапки читателя. */
export function mangaChapterShortLabel(chapter: {
  index: number;
  tome: number;
  number: string;
  name: string;
}): string {
  const number = chapter.number.trim();
  const base = !number || number === '0' ? 'Пролог' : `Глава ${number}`;
  return chapter.tome > 1 ? `Том ${chapter.tome}, ${base}` : base;
}

/** Подпись источника для атрибуции. */
export function mangaSourceLabel(): string {
  return 'Remanga';
}

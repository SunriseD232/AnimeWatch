/**
 * Ранобэ: мелкие типы и подписи, общие для сервера и браузера.
 *
 * Лежат отдельно от lib/ranobe.ts по той же причине, что bookShared: карточка
 * и читатель — клиентские компоненты, а серверный модуль ходит в сеть и в
 * Supabase. Если импортировать типы прямо оттуда, в клиентский бандл поедет
 * весь модуль и сборка упадёт на next/headers.
 *
 * Здесь нет ни одного импорта — и не должно появиться.
 */

/** Источник ранобэ. Пока один — Renovels. */
export type RanobeSource = 'renovels';

/** Карточка ранобэ — то, что нужно сетке каталога и карточке тайтла. */
export interface RanobeSummary {
  /** id тайтла у Renovels. Он же shikimori_id прогресса. */
  id: number;
  /**
   * Слаг для адресов. Renovels не умеет искать тайтл по числовому id
   * (`/api/titles/{id}/` отдаёт «тайтл не найден»), поэтому все ссылки
   * строятся по dir, а не по id.
   */
  dir: string;
  title: string;
  /** Оригинальное/английское название — для поиска и подписи под заголовком. */
  originalTitle: string | null;
  /** Происхождение/тип у источника: «Корея», «Япония», «Авторское» и т.п. */
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
export interface RanobeDetails extends RanobeSummary {
  /** Описание без HTML: в карточке показываем обычным текстом. */
  description: string | null;
  genres: string[];
  categories: string[];
  /** Ветка (перевод/издание), по которой запрашивается список глав. */
  branchId: number | null;
  /** Первая глава, если источник её отдал, — для кнопки «Начать читать». */
  firstChapterId: number | null;
  /** false — живой API не ответил, показана запись из нашего индекса. */
  sourceAvailable: boolean;
}

/** Глава в оглавлении. */
export interface RanobeChapter {
  id: number;
  /** Порядковый номер в выдаче (1..N). В progress уходит как episode. */
  index: number;
  tome: number;
  /** Номер главы у источника: «1», «1.1», «0». */
  number: string;
  /** Название главы; часто пустое. */
  name: string;
  /** Платная глава: текст недоступен без покупки у источника. */
  isPaid: boolean;
  isPublished: boolean;
  /** Готовая подпись: «Том 2, глава 1.1 — Название». */
  label: string;
}

/** Короткая ссылка на соседнюю главу из ответа /chapters/{id}/. */
export interface RanobeChapterRef {
  id: number;
  index: number;
  tome: number;
  number: string;
  isPaid: boolean;
}

/** Текст одной главы. */
export interface RanobeChapterContent {
  id: number;
  titleId: number;
  index: number;
  tome: number;
  number: string;
  name: string;
  isPaid: boolean;
  /** Очищенный сервером HTML. Пусто у платных/недоступных глав. */
  html: string;
  hasContent: boolean;
  previous: RanobeChapterRef | null;
  next: RanobeChapterRef | null;
}

/** Ссылка на карточку тайтла. */
export function ranobeTitleHref(dir: string): string {
  return `/ranobe/${encodeURIComponent(dir)}`;
}

/** Ссылка на читатель конкретной главы. */
export function ranobeReadHref(dir: string, chapterId: number): string {
  return `/ranobe/read/${encodeURIComponent(dir)}/${chapterId}`;
}

/**
 * Подпись главы. Renovels отдаёт номер строкой («0», «1.1»), том отдельно,
 * а название — не всегда. «Глава 0» выглядит странно, поэтому нулевую главу
 * называем прологом.
 */
export function formatRanobeChapterLabel(chapter: {
  index: number;
  tome: number;
  number: string;
  name: string;
}): string {
  const number = chapter.number.trim();
  const base = !number || number === '0' ? 'Пролог' : `Глава ${number}`;
  const tome = chapter.tome > 1 ? `Том ${chapter.tome}, ` : '';
  const name = chapter.name.trim();
  // У Renovels name часто повторяет номер («Глава 1»), а иногда продолжает
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
export function ranobeChapterShortLabel(chapter: {
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
export function ranobeSourceLabel(): string {
  return 'ReNovels';
}

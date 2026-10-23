/**
 * Реестр источников и порядок приоритета.
 *
 * Порядок в массиве = приоритет. Резолвер идёт слева направо и берёт первый
 * источник, где глава бесплатна. Remanga пока первый: она даёт метаданные и
 * бесплатные главы; MangaDex подхватывает платные эксклюзивы.
 *
 * Парсеры MangaLib/SelfManga/Yai/MintManga подключаются сюда по мере
 * готовности (этап 4 плана).
 */

import { flibustaRanobe } from './flibustaRanobe';
import { mangadex } from './mangadex';
import { mangalib } from './mangalib';
import { mintmanga } from './mintmanga';
import { remanga } from './remanga';
import { renovels } from './renovels';
import { selfmanga } from './selfmanga';
import type { ReadingContentType, SourceAdapter, SourceId } from './types';

export const ADAPTERS: Record<ReadingContentType, SourceAdapter[]> = {
  manga: [remanga, mangadex, mangalib, selfmanga, mintmanga],
  ranobe: [renovels, flibustaRanobe],
  // Книги читаются существующим book_index + BookReader, слой источников их
  // не затрагивает.
  book: [],
};

/** Адаптеры для типа контента в порядке приоритета. */
export function getAdapters(kind: ReadingContentType): SourceAdapter[] {
  return ADAPTERS[kind] ?? [];
}

/** Адаптер по id (первое совпадение). */
export function getAdapter(id: SourceId): SourceAdapter | null {
  for (const adapters of Object.values(ADAPTERS)) {
    for (const adapter of adapters) {
      if (adapter.id === id) return adapter;
    }
  }
  return null;
}

/** Включённые адаптеры для типа контента. */
export function getEnabledAdapters(kind: ReadingContentType): SourceAdapter[] {
  return getAdapters(kind).filter((adapter) => adapter.isEnabled());
}

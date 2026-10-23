/**
 * Флибуста — тома ранобэ (EPUB/FB2) через существующий книжный слой.
 *
 * Гранулярность — том, а не глава: FB2/EPUB не даёт надёжной постраничной
 * разбивки, а BookReader уже умеет EPUB. Поэтому адаптер не участвует в
 * каноническом оглавлении глав, а даёт отдельную кнопку «Читать том».
 */

import { bookFileUrl, searchBooks } from '@/lib/books';
import { isSourceEnabled } from './health';
import { titleScore } from './text';
import type {
  ResolvedContent,
  SourceAdapter,
  SourceChapter,
  SourceMatch,
  SourceTitleKey,
} from './types';

const MATCH_THRESHOLD = 0.6;

export const flibustaRanobe: SourceAdapter = {
  id: 'flibusta',
  kind: 'ranobe',
  granularity: 'volume',

  isEnabled(): boolean {
    return isSourceEnabled('flibusta');
  },

  async findByTitle(input: SourceTitleKey): Promise<SourceMatch | null> {
    const query = input.title.trim();
    if (!query) return null;

    const result = await searchBooks(query, 1);
    if (result.items.length === 0) return null;

    const targets = [input.title, ...(input.altTitles ?? [])];
    let best: { item: (typeof result.items)[number]; score: number } | null = null;

    for (const item of result.items) {
      let score = titleScore([item.title], targets);
      if (score < MATCH_THRESHOLD) continue;

      if (item.year != null && input.year != null && Math.abs(item.year - input.year) <= 1) {
        score = Math.min(1, score + 0.05);
      }

      if (!best || score > best.score) best = { item, score };
    }

    if (!best || best.score < MATCH_THRESHOLD) return null;

    return {
      source: 'flibusta',
      externalId: String(best.item.id),
      variant: `book-${best.item.id}`,
      title: best.item.title,
      confidence: best.score,
      language: best.item.language ?? 'ru',
      externalUrl: best.item.sourceUrl,
    };
  },

  async listChapters(): Promise<SourceChapter[]> {
    // Тома не входят в каноническую ось глав.
    return [];
  },

  async getChapter(match: SourceMatch): Promise<ResolvedContent | null> {
    const bookId = Number(match.externalId);
    if (!Number.isSafeInteger(bookId) || bookId <= 0) return null;

    return { format: 'epub', url: bookFileUrl(bookId, 'epub') };
  },
};

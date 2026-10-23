/**
 * Remanga — адаптер к существующему src/lib/manga.ts.
 *
 * Ничего не дублирует: каталог, карточка, главы и страницы уже реализованы.
 * Здесь только приведение к контракту SourceAdapter.
 */

import {
  getMangaChapterById,
  getMangaDetails,
  listMangaChapters,
  searchManga,
} from '@/lib/manga';
import { normalizeChapterNo } from './chapterLabel';
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

export const remanga: SourceAdapter = {
  id: 'remanga',
  kind: 'manga',
  granularity: 'chapter',

  isEnabled(): boolean {
    return isSourceEnabled('remanga');
  },

  async findByTitle(input: SourceTitleKey): Promise<SourceMatch | null> {
    const query = input.title.trim();
    if (!query) return null;

    const result = await searchManga(query, 1);
    if (result.items.length === 0) return null;

    const targets = [input.title, ...(input.altTitles ?? [])];
    let best: { item: (typeof result.items)[number]; score: number } | null = null;

    for (const item of result.items) {
      const names = [item.title, item.originalTitle, item.alternativeTitle].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );

      let score = titleScore(names, targets);
      if (score < MATCH_THRESHOLD) continue;

      if (item.year != null && input.year != null && Math.abs(item.year - input.year) <= 1) {
        score = Math.min(1, score + 0.05);
      }

      if (!best || score > best.score) best = { item, score };
    }

    if (!best || best.score < MATCH_THRESHOLD) return null;

    return {
      source: 'remanga',
      externalId: best.item.dir,
      variant: 'default',
      title: best.item.title,
      confidence: best.score,
      chaptersCount: best.item.chaptersCount ?? undefined,
      language: 'ru',
      externalUrl: best.item.sourceUrl,
    };
  },

  async listChapters(match: SourceMatch): Promise<SourceChapter[]> {
    const details = await getMangaDetails(match.externalId);
    const branchId = details?.branchId;
    if (!branchId) return [];

    const chapters = await listMangaChapters(
      branchId,
      details?.chaptersCount ?? 0,
    );

    return chapters.map((chapter) => ({
      source: 'remanga' as const,
      chapterKey: String(chapter.id),
      chapterNo: normalizeChapterNo(chapter.number),
      tome: chapter.tome,
      label: chapter.label,
      isPaid: chapter.isPaid,
      isFreeToday: chapter.isFreeToday,
    }));
  },

  async getChapter(
    _match: SourceMatch,
    chapterKey: string,
  ): Promise<ResolvedContent | null> {
    const chapterId = Number(chapterKey);
    if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return null;

    const content = await getMangaChapterById(chapterId);
    if (!content || !content.hasPages) return null;
    if (content.isPaid && !content.isFreeToday) return null;

    return {
      format: 'images',
      pages: content.pages.map((page) => ({
        url: page.url,
        width: page.width ?? undefined,
        height: page.height ?? undefined,
      })),
    };
  },
};

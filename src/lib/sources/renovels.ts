/**
 * Renovels — адаптер к существующему src/lib/ranobe.ts.
 *
 * Отдаёт главы и HTML-текст. Платные главы приходят с пустым content — их не
 * читаем и не выдаём за доступные.
 */

import {
  getRanobeChapterById,
  getRanobeDetails,
  listRanobeChapters,
  searchRanobe,
} from '@/lib/ranobe';
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

export const renovels: SourceAdapter = {
  id: 'renovels',
  kind: 'ranobe',
  granularity: 'chapter',

  isEnabled(): boolean {
    return isSourceEnabled('renovels');
  },

  async findByTitle(input: SourceTitleKey): Promise<SourceMatch | null> {
    const query = input.title.trim();
    if (!query) return null;

    const result = await searchRanobe(query, 1);
    if (result.items.length === 0) return null;

    const targets = [input.title, ...(input.altTitles ?? [])];
    let best: { item: (typeof result.items)[number]; score: number } | null = null;

    for (const item of result.items) {
      const names = [item.title, item.originalTitle].filter(
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
      source: 'renovels',
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
    const details = await getRanobeDetails(match.externalId);
    const branchId = details?.branchId;
    if (!branchId) return [];

    const chapters = await listRanobeChapters(branchId);

    return chapters.map((chapter) => ({
      source: 'renovels' as const,
      chapterKey: String(chapter.id),
      chapterNo: normalizeChapterNo(chapter.number),
      tome: chapter.tome,
      label: chapter.label,
      isPaid: chapter.isPaid,
      // Renovels не отдаёт «бесплатно сегодня» отдельным флагом.
      isFreeToday: false,
    }));
  },

  async getChapter(
    _match: SourceMatch,
    chapterKey: string,
  ): Promise<ResolvedContent | null> {
    const chapterId = Number(chapterKey);
    if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return null;

    const content = await getRanobeChapterById(chapterId);
    if (!content || !content.hasContent || content.isPaid) return null;

    return { format: 'html', html: content.html };
  },
};

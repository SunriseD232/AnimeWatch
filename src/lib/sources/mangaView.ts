/**
 * Преобразование канонических глав в форму, которую уже понимает
 * MangaReader и карточка манги.
 *
 * Так UI не знает про источники: он видит те же MangaChapter / 
 * MangaChapterContent, что и раньше. В каноническом режиме `id` — это
 * канонический idx, поэтому ссылки /read/[dir]/[idx] работают без ветвлений.
 */

import type {
  MangaChapter,
  MangaChapterContent,
  MangaPage,
} from '@/lib/mangaShared';
import { sourceShortLabel } from './chapterLabel';
import type { CanonicalChapter, ResolvedContent } from './types';

export function canonicalToMangaChapters(
  chapters: CanonicalChapter[],
): MangaChapter[] {
  return chapters.map((chapter) => {
    const free = chapter.sources.some(
      (source) => !source.isPaid || source.isFreeToday,
    );
    const freeToday = chapter.sources.some(
      (source) => source.isPaid && source.isFreeToday,
    );
    const labels = Array.from(
      new Set(chapter.sources.map((source) => sourceShortLabel(source.source))),
    );

    return {
      id: chapter.idx,
      index: chapter.idx,
      tome: chapter.tome ?? 1,
      number:
        chapter.chapterNo != null
          ? String(chapter.chapterNo)
          : String(chapter.idx),
      name: '',
      isPaid: chapter.sources.length > 0 && !free,
      isFreeToday: freeToday,
      isReadable: free,
      label: chapter.label,
      sourceLabels: labels,
    };
  });
}

export function canonicalChapterContent(input: {
  titleId: number;
  chapter: CanonicalChapter;
  content: ResolvedContent | null;
  paid: boolean;
}): MangaChapterContent {
  const pages: MangaPage[] =
    input.content?.format === 'images'
      ? input.content.pages.map((page) => ({
          url: page.url,
          width: page.width ?? null,
          height: page.height ?? null,
        }))
      : [];

  const number =
    input.chapter.chapterNo != null
      ? String(input.chapter.chapterNo)
      : String(input.chapter.idx);

  return {
    id: input.chapter.idx,
    titleId: input.titleId,
    index: input.chapter.idx,
    tome: input.chapter.tome ?? 1,
    number,
    name: '',
    isPaid: input.paid,
    isFreeToday: false,
    pages,
    hasPages: pages.length > 0,
  };
}

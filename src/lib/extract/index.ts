import { extractAlloha } from './alloha';
import { extractVideoseed } from './videoseed';
import type { ExtractParams, ExtractSource, ResolvedStream } from './types';

export type { ExtractSource, ResolvedStream } from './types';

/** Запускает Puppeteer-экстрактор нужного источника. Без кэша — см. resolve.ts. */
export function extractStream(
  source: ExtractSource,
  params: ExtractParams,
): Promise<ResolvedStream | null> {
  switch (source) {
    case 'alloha':
      return extractAlloha(params);
    case 'videoseed':
      return extractVideoseed(params);
  }
}

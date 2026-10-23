import { fetchRanobeCatalogPage, ranobeIndexRow } from '@/lib/ranobe';
import type { RanobeSummary } from '@/lib/ranobeShared';
import {
  crawlFull,
  rebuildShowcase,
  type CatalogIndexSpec,
} from '@/lib/catalogIndex';

/**
 * Каталог ранобэ (миграция 0055) поверх lib/catalogIndex.ts:
 *   • ночью — витрина популярного (rank), см. rebuildRanobeIndex;
 *   • раз в неделю — полный обход Renovels (~98 тыс. тайтлов, ~3 266
 *     страниц), см. crawlRanobeFull: он решает, что есть в каталоге.
 */
const SPEC: CatalogIndexSpec<RanobeSummary> = {
  label: 'ранобэ',
  table: 'ranobe_index',
  stateTable: 'ranobe_index_state',
  fetchPage: (options) => fetchRanobeCatalogPage(options),
  toRow: ranobeIndexRow,
  // Порядок = приоритет в витрине. Категория «Новелла» (196) — страховка,
  // если общий каталог подмешает не-новеллы.
  showcase: [
    { ordering: '-views', pages: 20 },
    { ordering: '-rating', pages: 14 },
    { ordering: '-count_chapters', pages: 14 },
    { ordering: '-id', pages: 7 },
    { ordering: '-views', pages: 9, categories: 196 },
  ],
  fullOrdering: '-id',
  // 30 — потолок каталога Renovels: с 23.10.2026 на count > 30 он отвечает 400.
  pageSize: 30,
};

export interface RanobeReindexResult {
  ranobe: number;
  requests: number;
  durationMs: number;
}

/** Ночная витрина. Бросает — причину пишет крон в ranobe_index_state. */
export async function rebuildRanobeIndex(): Promise<RanobeReindexResult> {
  const { titles, requests, durationMs } = await rebuildShowcase(SPEC);
  return { ranobe: titles, requests, durationMs };
}

/** Еженедельный полный обход Renovels. */
export async function crawlRanobeFull(): Promise<RanobeReindexResult> {
  const { titles, requests, durationMs } = await crawlFull(SPEC);
  return { ranobe: titles, requests, durationMs };
}

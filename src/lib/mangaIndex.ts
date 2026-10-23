import { fetchMangaCatalogPage, mangaIndexRow } from '@/lib/manga';
import type { MangaSummary } from '@/lib/mangaShared';
import {
  crawlFull,
  rebuildShowcase,
  type CatalogIndexSpec,
} from '@/lib/catalogIndex';

/**
 * Каталог манги (миграция 0056) поверх lib/catalogIndex.ts:
 *   • ночью — витрина популярного (rank), см. rebuildMangaIndex;
 *   • раз в неделю — полный обход Remanga (~55 тыс. тайтлов, два прохода
 *     по 1000 страниц), см. crawlMangaFull: он решает, что есть в каталоге.
 *
 * manga_index — постоянный кэш лёгких метаданных без batch_id: строки, по
 * которым уже открывали карточки и «Продолжить», не удаляются.
 */
const SPEC: CatalogIndexSpec<MangaSummary> = {
  label: 'манга',
  table: 'manga_index',
  stateTable: 'manga_index_state',
  fetchPage: (options) => fetchMangaCatalogPage(options),
  toRow: mangaIndexRow,
  // Порядок = приоритет в витрине: просмотры — то, что людям интересно;
  // рейтинг — лучшее по оценкам; число глав — состоявшиеся тайтлы; новые id —
  // свежие поступления.
  showcase: [
    { ordering: '-views', pages: 20 },
    { ordering: '-rating', pages: 14 },
    { ordering: '-count_chapters', pages: 14 },
    { ordering: '-id', pages: 8 },
  ],
  // По id каталог не перетасовывается между страницами во время обхода.
  // Два прохода навстречу: каждый — не больше 30 тыс. (1000 страниц), а
  // тайтлов ~55 тыс.; на 24.10.2026 они перекрываются (до id 98 782 снизу,
  // от 92 799 сверху).
  fullOrderings: ['-id', 'id'],
  // 30 — проверенный максимум каталога (на 32 Remanga отвечает 400).
  pageSize: 30,
};

export interface MangaReindexResult {
  manga: number;
  requests: number;
  durationMs: number;
}

/** Ночная витрина. Бросает — причину пишет крон в manga_index_state. */
export async function rebuildMangaIndex(): Promise<MangaReindexResult> {
  const { titles, requests, durationMs } = await rebuildShowcase(SPEC);
  return { manga: titles, requests, durationMs };
}

/** Еженедельный полный обход Remanga. */
export async function crawlMangaFull(): Promise<MangaReindexResult> {
  const { titles, requests, durationMs } = await crawlFull(SPEC);
  return { manga: titles, requests, durationMs };
}

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Общая пересборка индексов манги и ранобэ (manga_index, ranobe_index).
 *
 * Два режима с разным смыслом флагов:
 *
 *   • ночная витрина (rebuildShowcase) — несколько страниц популярных
 *     сортировок. Ставит им rank (порядок на главной странице раздела) и
 *     снимает rank с остальных. in_catalog НЕ трогает: раньше ночной прогон
 *     снимал его со всего, чего не было в витрине, и с полным каталогом
 *     раздел каждую ночь усыхал бы с десятков тысяч тайтлов до тысячи;
 *   • полный обход (crawlFull) — раз в неделю весь каталог источника. Это он
 *     решает, что есть в каталоге: всё увиденное — in_catalog = true, всё
 *     не увиденное за прогон — false (источник убрал тайтл). Строки не
 *     удаляются: по ним открываются карточки и «Продолжить».
 *
 * Тайтлы без rank идут в каталоге после витрины — по просмотрам (см.
 * getMangaCatalog/getRanobeCatalog).
 */

export interface CatalogSource {
  /** Проверенная живьём сортировка источника. */
  ordering: string;
  pages: number;
  /** Дополнительный фильтр каталога (у ранобэ — категория «Новелла»). */
  categories?: number;
}

export interface CatalogPage<T> {
  items: T[];
  total: number;
  totalPages: number;
}

export interface CatalogIndexSpec<T extends { id: number }> {
  /** Для логов и сообщений об ошибке: «манга», «ранобэ». */
  label: string;
  table: 'manga_index' | 'ranobe_index';
  stateTable: 'manga_index_state' | 'ranobe_index_state';
  fetchPage(options: {
    ordering: string;
    page: number;
    count: number;
    categories?: number | null;
  }): Promise<CatalogPage<T>>;
  toRow(
    item: T,
    overrides: { rank?: number | null; inCatalog?: boolean; updatedAt?: string },
  ): object;
  /** Витрина: порядок источников = приоритет. */
  showcase: CatalogSource[];
  /**
   * Сортировки полного обхода. Одной мало: Remanga и Renovels отдают не
   * дальше 1000-й страницы («Слишком большая страница», 24.10.2026) — это
   * 30 тыс. тайтлов на сортировку. Проходы с разных концов (-id и id,
   * просмотры, рейтинг…) вместе покрывают каталог; обход останавливается,
   * как только собрано заявленное источником число.
   */
  fullOrderings: string[];
  /** Записей на страницу — проверенный максимум источника. */
  pageSize: number;
}

export interface CatalogRunResult {
  titles: number;
  requests: number;
  durationMs: number;
}

/** Пауза между запросами: чужой API, идём ночью и не спешим. */
const REQUEST_INTERVAL_MS = 250;
/** Меньше этого в витрине — почти наверняка обрыв, а не «каталог усох». */
const MIN_SANE = 150;
/** Полный обход должен увидеть хотя бы такую долю заявленного источником. */
const MIN_FULL_COVERAGE = 0.8;
/** И не усохнуть сильнее чем вдвое к прошлому полному обходу. */
const MAX_SHRINK_RATIO = 0.5;
/** Дальше 1000-й страницы источники не отдают (см. fullOrderings). */
const MAX_PAGES = 1000;
/** Повторы пустой страницы посреди каталога: 5, 15, 45 секунд. */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
const CHUNK = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertChunk(table: string, rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await createServiceClient()
    .from(table)
    .upsert(rows, { onConflict: 'title_id' });
  if (error) throw new Error(`upsert ${table}: ${error.message}`);
}

async function countInCatalog(table: string): Promise<number | null> {
  const { count } = await createServiceClient()
    .from(table)
    .select('title_id', { count: 'exact', head: true })
    .eq('in_catalog', true);
  return count ?? null;
}

/** Ночная витрина: популярное сверху, rank. Бросает — причину пишет крон. */
export async function rebuildShowcase<T extends { id: number }>(
  spec: CatalogIndexSpec<T>,
): Promise<CatalogRunResult> {
  const startedAt = new Date();
  const supabase = createServiceClient();
  await supabase
    .from(spec.stateTable)
    .update({ last_run_started_at: startedAt.toISOString(), last_error: null })
    .eq('id', true);

  const found = new Map<number, T>();
  let requests = 0;

  for (const source of spec.showcase) {
    for (let page = 1; page <= source.pages; page++) {
      const res = await spec.fetchPage({
        ordering: source.ordering,
        page,
        count: spec.pageSize,
        categories: source.categories,
      });
      requests++;
      if (res.items.length === 0) break;
      for (const item of res.items) if (!found.has(item.id)) found.set(item.id, item);
      if (page >= res.totalPages) break;
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  if (found.size < MIN_SANE) {
    throw new Error(`витрина ${spec.label} подозрительно мала: ${found.size} — порядок не меняю`);
  }

  const nowIso = new Date().toISOString();
  const rows = [...found.values()].map((item, i) =>
    spec.toRow(item, { rank: i + 1, inCatalog: true, updatedAt: nowIso }),
  );
  for (let i = 0; i < rows.length; i += CHUNK) {
    await upsertChunk(spec.table, rows.slice(i, i + CHUNK));
  }

  // Снять rank с тех, кто выпал из витрины. in_catalog не трогаем — см.
  // комментарий в начале файла.
  const { error: rankError } = await supabase
    .from(spec.table)
    .update({ rank: null })
    .not('rank', 'is', null)
    .lt('updated_at', startedAt.toISOString());

  const total = await countInCatalog(spec.table);
  const { error: stateError } = await supabase
    .from(spec.stateTable)
    .update({
      built_at: new Date().toISOString(),
      ...(total != null ? { titles_count: total } : {}),
      last_run_finished_at: new Date().toISOString(),
      last_error: rankError ? `rank не сброшен: ${rankError.message}` : null,
    })
    .eq('id', true);
  if (stateError) throw new Error(`не записал состояние: ${stateError.message}`);

  return { titles: found.size, requests, durationMs: Date.now() - startedAt.getTime() };
}

/**
 * Полный обход каталога источника. Пишет порциями (память VPS не держит
 * сто тысяч объектов зря) и только в конце, если обход полный и
 * вменяемый, снимает in_catalog с не увиденного. Бросает — причину пишет крон;
 * уже записанные порции при этом безвредны: это свежие метаданные.
 */
export async function crawlFull<T extends { id: number }>(
  spec: CatalogIndexSpec<T>,
): Promise<CatalogRunResult> {
  const startedAt = new Date();
  const supabase = createServiceClient();
  await supabase
    .from(spec.stateTable)
    .update({ last_run_started_at: startedAt.toISOString(), last_error: null })
    .eq('id', true);

  const seen = new Set<number>();
  let pending: object[] = [];
  let requests = 0;
  let declaredTotal = 0;

  orderings: for (const ordering of spec.fullOrderings) {
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page++) {
      let res = await spec.fetchPage({ ordering, page, count: spec.pageSize });
      requests++;
      // Пустая страница посреди каталога — сбой источника, а не конец:
      // повторяем, и только потом сдаёмся (без снятия in_catalog).
      for (const delay of RETRY_DELAYS_MS) {
        if (res.items.length > 0) break;
        await sleep(delay);
        res = await spec.fetchPage({ ordering, page, count: spec.pageSize });
        requests++;
      }
      if (res.items.length === 0) {
        throw new Error(
          `${spec.label}: ${ordering}, страница ${page} из ${totalPages} пустая после повторов — обход прерван, каталог не урезан`,
        );
      }
      if (page === 1) {
        totalPages = Math.min(res.totalPages, MAX_PAGES);
        declaredTotal = Math.max(declaredTotal, res.total);
      }

      const nowIso = new Date().toISOString();
      for (const item of res.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        // Без rank: порядок витрины — дело ночного прогона.
        const row = spec.toRow(item, { inCatalog: true, updatedAt: nowIso }) as Record<string, unknown>;
        delete row.rank;
        pending.push(row);
      }
      if (pending.length >= CHUNK) {
        await upsertChunk(spec.table, pending);
        pending = [];
      }
      // Собрано всё, что заявил источник, — остальные проходы не нужны.
      if (declaredTotal > 0 && seen.size >= declaredTotal) break orderings;
      await sleep(REQUEST_INTERVAL_MS);
    }
  }
  await upsertChunk(spec.table, pending);

  const { data: state } = await supabase
    .from(spec.stateTable)
    .select('titles_count')
    .eq('id', true)
    .maybeSingle();
  const previous = Number(state?.titles_count ?? 0);
  const coverage = declaredTotal > 0 ? seen.size / declaredTotal : 1;
  if (coverage < MIN_FULL_COVERAGE || (previous > 0 && seen.size < previous * MAX_SHRINK_RATIO)) {
    throw new Error(
      `${spec.label}: увидено ${seen.size} из ${declaredTotal} (было ${previous}) — каталог не урезаю`,
    );
  }

  const { error: sweepError } = await supabase
    .from(spec.table)
    .update({ in_catalog: false, rank: null })
    .eq('in_catalog', true)
    .lt('updated_at', startedAt.toISOString());

  const { error: stateError } = await supabase
    .from(spec.stateTable)
    .update({
      built_at: new Date().toISOString(),
      titles_count: seen.size,
      last_run_finished_at: new Date().toISOString(),
      last_error: sweepError ? `не снял исчезнувшие: ${sweepError.message}` : null,
    })
    .eq('id', true);
  if (stateError) throw new Error(`не записал состояние: ${stateError.message}`);

  return { titles: seen.size, requests, durationMs: Date.now() - startedAt.getTime() };
}

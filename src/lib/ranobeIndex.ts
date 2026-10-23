import { createServiceClient } from '@/lib/supabase/service';
import {
  fetchRanobeCatalogPage,
  ranobeIndexRow,
  type RanobeIndexRow,
} from '@/lib/ranobe';
import type { RanobeSummary } from '@/lib/ranobeShared';

/**
 * Витрина каталога ранобэ (см. миграцию 0055).
 *
 * Renovels отдаёт каталог страницами, но без «одного правильного» порядка:
 * сортировка по рейтингу выносит вперёд старые тайтлы, по просмотрам —
 * популярные, по числу глав — длинные. Поэтому витрина собирается из
 * нескольких проходов по разным сортировкам и склеивается по id. Первое
 * вхождение получает меньший rank: популярные оказываются выше, свежие —
 * ниже, но всё равно в каталоге.
 *
 * Как у книг, здесь нет batch_id: ranobe_index — постоянный кэш лёгких
 * метаданных. Пересборка только переставляет флаг in_catalog и rank; строки,
 * которые уже открывали из поиска, остаются ради карточек и «продолжить».
 */

interface Source {
  /** Проверенная живьём сортировка Renovels. */
  ordering: string;
  pages: number;
  /** Дополнительный фильтр каталога (196 — категория «Новелла»). */
  categories?: number;
}

/**
 * Порядок источников = приоритет в витрине.
 *   • просмотры — то, что людям действительно интересно;
 *   • рейтинг — лучшее по оценкам;
 *   • число глав — длинные, состоявшиеся тайтлы;
 *   • новые id — свежие поступления;
 *   • категория «Новелла» — страховка, если общий каталог подмешает не-новеллы.
 */
// Страниц больше, чем было при 50 записях: охват витрины тот же
// (~1850 записей до склейки дублей), просто мельче нарезан.
const SOURCES: Source[] = [
  { ordering: '-views', pages: 20 },
  { ordering: '-rating', pages: 14 },
  { ordering: '-count_chapters', pages: 14 },
  { ordering: '-id', pages: 7 },
  { ordering: '-views', pages: 9, categories: 196 },
];

/** 30 записей на страницу — потолок каталога Renovels. На count > 30 он с
 *  23.10.2026 отвечает 400 (раньше пропускал 50, и витрина целиком падала
 *  бы на первом же запросе). */
const PAGE_SIZE = 30;

/** Пауза между запросами: чужой API, идём ночью и не спешим. */
const REQUEST_INTERVAL_MS = 250;

/** Потолок памяти на 2 ГБ VPS. */
const MAX_RANOBE = 5000;

/** Меньше этого — почти наверняка обрыв, а не «каталог усох». */
const MIN_SANE = 150;

/** Усадка сильнее чем в два раза — тоже повод не трогать витрину. */
const MAX_SHRINK_RATIO = 0.5;

/** Размер пачки в upsert. */
const CHUNK = 500;

export interface RanobeReindexResult {
  ranobe: number;
  requests: number;
  durationMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Полная перестройка витрины. Возвращает статистику или бросает — причину
 * пишет вызывающий (крон-роут) в ranobe_index_state.
 */
export async function rebuildRanobeIndex(): Promise<RanobeReindexResult> {
  const startedAt = new Date();
  const supabase = createServiceClient();

  await supabase
    .from('ranobe_index_state')
    .update({ last_run_started_at: startedAt.toISOString(), last_error: null })
    .eq('id', true);

  // ── 1. Сбор в память ──
  const found = new Map<number, RanobeSummary>();
  let requests = 0;

  for (const source of SOURCES) {
    for (let page = 1; page <= source.pages && found.size < MAX_RANOBE; page++) {
      const res = await fetchRanobeCatalogPage({
        ordering: source.ordering,
        page,
        count: PAGE_SIZE,
        categories: source.categories,
      });
      requests++;

      if (res.items.length === 0) break;

      for (const item of res.items) {
        if (found.size >= MAX_RANOBE) break;
        if (!found.has(item.id)) found.set(item.id, item);
      }

      // Последняя страница: дальше заведомо пусто.
      if (page >= res.totalPages) break;
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  const ranobe = [...found.values()];
  const fresh = ranobe.length;

  // ── 2. Проверка вменяемости ──
  const { data: state } = await supabase
    .from('ranobe_index_state')
    .select('titles_count')
    .eq('id', true)
    .maybeSingle();

  const previous = state?.titles_count ?? 0;
  const shrunk = previous > 0 && fresh < previous * MAX_SHRINK_RATIO;

  if (fresh < MIN_SANE || shrunk) {
    throw new Error(
      `выборка подозрительно мала: ${fresh} (было ${previous}) — витрину не меняю`,
    );
  }

  // ── 3. Upsert собранного ──
  const nowIso = new Date().toISOString();
  const rows: RanobeIndexRow[] = ranobe.map((item, i) =>
    ranobeIndexRow(item, { rank: i + 1, inCatalog: true, updatedAt: nowIso }),
  );

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('ranobe_index')
      .upsert(chunk, { onConflict: 'title_id' });
    if (error) {
      throw new Error(`upsert упал на строке ${i}: ${error.message}`);
    }
  }

  // ── 4. Убрать из витрины то, чего больше нет ──
  const { error: sweepError } = await supabase
    .from('ranobe_index')
    .update({ in_catalog: false, rank: null })
    .eq('in_catalog', true)
    .lt('updated_at', startedAt.toISOString());

  if (sweepError) {
    console.error(
      '[ranobeIndex] убрать старые тайтлы из витрины не удалось:',
      sweepError.message,
    );
  }

  const { error: stateError } = await supabase
    .from('ranobe_index_state')
    .update({
      built_at: new Date().toISOString(),
      titles_count: fresh,
      last_run_finished_at: new Date().toISOString(),
      last_error: sweepError ? `витрина не подчищена: ${sweepError.message}` : null,
    })
    .eq('id', true);

  if (stateError) {
    throw new Error(`не записал состояние индекса: ${stateError.message}`);
  }

  return {
    ranobe: fresh,
    requests,
    durationMs: Date.now() - startedAt.getTime(),
  };
}

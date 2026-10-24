import { createServiceClient } from '@/lib/supabase/service';
import { fetchKnigavuheListPage } from '@/lib/sources/knigavuhe';
import type { AudiobookSummary } from '@/lib/audiobookShared';

/**
 * Индекс аудиокниг (audiobook_index, миграция 0064) — обходом списка новинок
 * knigavuhe. Два режима, как у манги (lib/catalogIndex.ts):
 *
 *   • ночью — первые NIGHTLY_PAGES страниц: свежие поступления появляются
 *     на сайте на следующий день, а не через неделю;
 *   • раз в неделю — весь список (~6,5 тыс. страниц, ~65 тыс. книг). Он
 *     решает, что есть в каталоге: не увиденное за полный прогон — снято
 *     (in_catalog = false), но строка остаётся ради «Продолжить слушать».
 *
 * После записи — сопоставление с книгами Флибусты (match_audiobooks в базе):
 * только новые и изменившиеся строки, пачками.
 */

const NIGHTLY_PAGES = 30;
/** Предохранитель полного обхода: 24.10.2026 в списке 6 547 страниц. */
const MAX_PAGES = 12_000;
/** Пауза между страницами: чужой сайт, идём ночью и не спешим. */
const REQUEST_INTERVAL_MS = 300;
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
const CHUNK = 500;
/** Полный обход должен увидеть хотя бы такую долю прошлого каталога —
 *  иначе это обрыв, а не «книги удалили», и снимать ничего нельзя. */
const MIN_FULL_COVERAGE = 0.8;
const MATCH_BATCH = 2000;

export interface AudiobookRunResult {
  titles: number;
  matched: number;
  pages: number;
  durationMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRow(item: AudiobookSummary, nowIso: string): object {
  // book_id и matched_at не пишем: их ставит сопоставление, и обход не
  // должен их стирать. updated_at новее matched_at — сигнал сопоставить
  // строку заново (название могли поправить).
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    authors: item.authors,
    authors_text: item.authors.join(', ') || null,
    readers: item.readers,
    genres: item.genres,
    annotation: item.annotation,
    duration_seconds: item.durationSeconds,
    cover_url: item.coverUrl,
    views: item.views,
    likes: item.likes,
    in_catalog: true,
    updated_at: nowIso,
  };
}

async function upsert(rows: object[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await createServiceClient()
      .from('audiobook_index')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' });
    if (error) throw new Error(`upsert audiobook_index: ${error.message}`);
  }
}

async function setState(patch: Record<string, unknown>): Promise<void> {
  await createServiceClient().from('audiobook_index_state').update(patch).eq('id', true);
}

async function fetchWithRetry(page: number): Promise<AudiobookSummary[] | null> {
  let res = await fetchKnigavuheListPage(page);
  for (const delay of RETRY_DELAYS_MS) {
    if (res) break;
    await sleep(delay);
    res = await fetchKnigavuheListPage(page);
  }
  return res;
}

/** Сопоставление пачками, пока есть что сопоставлять. */
export async function matchAudiobooks(): Promise<number> {
  let matched = 0;
  for (;;) {
    const { data, error } = await createServiceClient().rpc('match_audiobooks', { lim: MATCH_BATCH });
    if (error) throw new Error(`match_audiobooks: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { processed: number; matched: number } | null;
    if (!row || Number(row.processed) === 0) break;
    matched += Number(row.matched);
  }
  return matched;
}

async function crawl(full: boolean): Promise<AudiobookRunResult> {
  const startedAt = new Date();
  await setState({ last_run_started_at: startedAt.toISOString(), last_error: null });

  try {
    const seen = new Set<number>();
    let pages = 0;
    let pending: object[] = [];
    const nowIso = startedAt.toISOString();
    const limit = full ? MAX_PAGES : NIGHTLY_PAGES;

    for (let page = 1; page <= limit; page++) {
      const items = await fetchWithRetry(page);
      pages++;
      if (items == null) throw new Error(`knigavuhe не отдал страницу ${page} — обход прерван`);
      if (items.length === 0) break;
      let fresh = 0;
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        pending.push(toRow(item, nowIso));
        fresh++;
      }
      // За последней страницей сайт отдаёт её же снова — новых книг нет.
      if (fresh === 0) break;
      if (pending.length >= CHUNK) {
        await upsert(pending);
        pending = [];
      }
      await sleep(REQUEST_INTERVAL_MS);
    }
    await upsert(pending);

    const supabase = createServiceClient();
    if (full) {
      const { count } = await supabase
        .from('audiobook_index')
        .select('id', { count: 'exact', head: true })
        .eq('in_catalog', true);
      const before = count ?? 0;
      if (before > 0 && seen.size < before * MIN_FULL_COVERAGE) {
        throw new Error(
          `полный обход увидел ${seen.size} из ${before} книг — похоже на обрыв, каталог не сужаю`,
        );
      }
      const { error: sweepError } = await supabase
        .from('audiobook_index')
        .update({ in_catalog: false })
        .eq('in_catalog', true)
        .lt('updated_at', nowIso);
      if (sweepError) throw new Error(`снятие исчезнувших: ${sweepError.message}`);
    }

    await matchAudiobooks();

    const [{ count: total }, { count: matchedTotal }] = await Promise.all([
      supabase.from('audiobook_index').select('id', { count: 'exact', head: true }).eq('in_catalog', true),
      supabase
        .from('audiobook_index')
        .select('id', { count: 'exact', head: true })
        .eq('in_catalog', true)
        .not('book_id', 'is', null),
    ]);

    await setState({
      built_at: new Date().toISOString(),
      titles_count: total ?? 0,
      matched_count: matchedTotal ?? 0,
      last_run_finished_at: new Date().toISOString(),
    });

    return {
      titles: seen.size,
      matched: matchedTotal ?? 0,
      pages,
      durationMs: Date.now() - startedAt.getTime(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setState({ last_run_finished_at: new Date().toISOString(), last_error: message });
    throw err;
  }
}

/** Ночной обход новинок. */
export function crawlAudiobooksNew(): Promise<AudiobookRunResult> {
  return crawl(false);
}

/** Еженедельный полный обход. */
export function crawlAudiobooksFull(): Promise<AudiobookRunResult> {
  return crawl(true);
}

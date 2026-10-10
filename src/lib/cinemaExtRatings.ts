import { createServiceClient } from '@/lib/supabase/service';
import { mapWithConcurrency } from '@/lib/concurrency';

/**
 * Рейтинги Кинопоиска и IMDb для каталога кино (см. миграцию 0049).
 *
 * Источник — открытый rating.kinopoisk.ru/<kp_id>.xml: без ключа, сразу обе
 * оценки с числом голосов, ответ за доли секунды (замерено с VPS 2026-10-10:
 * 0,07 с). Но это один запрос на тайтл, а тайтлов около 94 тысяч, поэтому
 * схема та же, что у рейтингов TMDB (lib/cinemaRatings.ts): своя таблица
 * cinema_ext_ratings, которая переживает перестройку каталога, потолок
 * запросов за прогон, а в выдачу оценки попадают ближайшей ночной
 * перестройкой — она копирует их в cinema_index.
 *
 * Порядок: сначала ни разу не проверенные, самые популярные вперёд (их
 * чаще видят на карточках), потом самые давно проверенные. Оценки КП у
 * вышедшего фильма меняются медленно — двух недель свежести хватает.
 */

const RATING_URL = (kpId: number) => `https://rating.kinopoisk.ru/${kpId}.xml`;
const FETCH_TIMEOUT_MS = 10_000;
/** Запросов за прогон. При 6 параллельных и ~0,1 с на ответ это минут пять;
 *  вся база закрывается за три-четыре ночи, дальше — только протухшие. */
const DEFAULT_BUDGET = 30_000;
/** Параллельных запросов — вежливо к чужому сервису без ключа. */
const CONCURRENCY = 6;
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const READ_PAGE = 1000;
const UPSERT_CHUNK = 500;

interface ExtRating {
  kp_id: number;
  kp_rating: number | null;
  kp_votes: number | null;
  imdb_rating: number | null;
  imdb_votes: number | null;
  checked_at: string;
}

/** Разбор ответа: <kp_rating num_vote="1148910">9.111</kp_rating>. Нулевая
 *  оценка без голосов у КП означает «оценок нет», а не ноль. */
export function parseKpRatingXml(xml: string): Pick<ExtRating, 'kp_rating' | 'kp_votes' | 'imdb_rating' | 'imdb_votes'> {
  const pick = (tag: string) => {
    const m = new RegExp(`<${tag}(?:\\s+num_vote="(\\d+)")?\\s*>([\\d.]+)</${tag}>`).exec(xml);
    if (!m) return { rating: null, votes: null };
    const rating = Number(m[2]);
    const votes = m[1] != null ? Number(m[1]) : null;
    if (!Number.isFinite(rating) || rating <= 0) return { rating: null, votes };
    return { rating, votes };
  };
  const kp = pick('kp_rating');
  const imdb = pick('imdb_rating');
  return {
    kp_rating: kp.rating != null ? Math.round(kp.rating * 100) / 100 : null,
    kp_votes: kp.votes,
    imdb_rating: imdb.rating != null ? Math.round(imdb.rating * 10) / 10 : null,
    imdb_votes: imdb.votes,
  };
}

async function loadBatchKpIds(
  supabase: ReturnType<typeof createServiceClient>,
  batchId: string,
): Promise<{ kpId: number; popularity: number }[]> {
  const out: { kpId: number; popularity: number }[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('cinema_index')
      .select('kp_id, popularity')
      .eq('batch_id', batchId)
      // order() обязателен — см. те же циклы в cinemaRatings.ts/cinemaGenres.ts.
      .order('kp_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`не прочитать kp_id партии: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { kp_id: number; popularity: number | null }[]) {
      out.push({ kpId: r.kp_id, popularity: Number(r.popularity) || 0 });
    }
  }
  return out;
}

async function loadCheckedAt(supabase: ReturnType<typeof createServiceClient>): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('cinema_ext_ratings')
      .select('kp_id, checked_at')
      .order('kp_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`не прочитать cinema_ext_ratings: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { kp_id: number; checked_at: string }[]) {
      out.set(r.kp_id, new Date(r.checked_at).getTime());
    }
  }
  return out;
}

export interface ExtRatingsRunResult {
  candidates: number;
  requested: number;
  withKp: number;
  withImdb: number;
  failed: number;
  durationMs: number;
}

export async function refreshCinemaExtRatings(budget = DEFAULT_BUDGET): Promise<ExtRatingsRunResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();

  const { data: state } = await supabase
    .from('cinema_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();
  const batchId = state?.active_batch as string | undefined;
  if (!batchId) throw new Error('активной партии нет — сначала должна отработать перестройка');

  const titles = await loadBatchKpIds(supabase, batchId);
  const checked = await loadCheckedAt(supabase);
  const staleBefore = Date.now() - STALE_AFTER_MS;

  const unchecked = titles.filter((t) => !checked.has(t.kpId)).sort((a, b) => b.popularity - a.popularity);
  const stale = titles
    .filter((t) => (checked.get(t.kpId) ?? Infinity) < staleBefore)
    .sort((a, b) => (checked.get(a.kpId) ?? 0) - (checked.get(b.kpId) ?? 0));
  const queue = [...unchecked, ...stale].slice(0, budget);

  let failed = 0;
  const pending: ExtRating[] = [];
  let withKp = 0;
  let withImdb = 0;

  const flush = async () => {
    while (pending.length > 0) {
      const chunk = pending.splice(0, UPSERT_CHUNK);
      const { error } = await supabase.from('cinema_ext_ratings').upsert(chunk, { onConflict: 'kp_id' });
      if (error) throw new Error(`не записались рейтинги: ${error.message}`);
    }
  };

  await mapWithConcurrency(queue, CONCURRENCY, async ({ kpId }) => {
    try {
      const res = await fetch(RATING_URL(kpId), {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (MediaWatch ratings)' },
      });
      if (!res.ok) {
        failed++;
        return;
      }
      const parsed = parseKpRatingXml(await res.text());
      if (parsed.kp_rating != null) withKp++;
      if (parsed.imdb_rating != null) withImdb++;
      pending.push({ kp_id: kpId, ...parsed, checked_at: new Date().toISOString() });
      if (pending.length >= UPSERT_CHUNK) await flush();
    } catch {
      // Сеть моргнула или таймаут — тайтл останется непроверенным и попадёт
      // в следующий прогон первым.
      failed++;
    }
  });
  await flush();

  return {
    candidates: unchecked.length + stale.length,
    requested: queue.length,
    withKp,
    withImdb,
    failed,
    durationMs: Date.now() - startedAt,
  };
}

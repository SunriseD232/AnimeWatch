import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Оценки IMDb из официальной выгрузки title.ratings.tsv.gz (см. миграцию
 * 0050). Схема — как у жанров IMDb (lib/cinemaGenres.ts): один файл без
 * ключа и лимитов вместо запроса на тайтл, разбор потоком, отдельная
 * таблица, которая переживает перестройку каталога; в выдачу оценки
 * попадают ближайшей перестройкой.
 *
 * Зачем, если IMDb уже отдаёт Кинопоиск (lib/cinemaExtRatings.ts): там она
 * есть не у всех — у 8 543 тайтлов с imdb_id не было, а выгрузка закрыла
 * 4 937 из них (замерено 2026-10-11). И это первоисточник, а не копия.
 */

const DATASET_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const READ_PAGE = 1000;
const UPSERT_CHUNK = 1000;
const EXPECTED_HEADER = 'tconst\taverageRating\tnumVotes';
/** Ниже этой доли найденных — похоже на смену формата, ничего не пишем
 *  (та же страховка, что у жанров; на проде находится 94%). */
const MIN_MATCH_RATIO = 0.5;

async function loadBatchImdbIds(
  supabase: ReturnType<typeof createServiceClient>,
  batchId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('cinema_index')
      .select('imdb_id')
      .eq('batch_id', batchId)
      .not('imdb_id', 'is', null)
      // order() обязателен — см. те же циклы в cinemaGenres.ts.
      .order('kp_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`не прочитать imdb_id партии: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { imdb_id: string | null }[]) if (r.imdb_id) out.add(r.imdb_id);
  }
  return out;
}

export interface ImdbRatingsRunResult {
  wanted: number;
  matched: number;
  scanned: number;
  durationMs: number;
}

export async function refreshCinemaImdbRatings(): Promise<ImdbRatingsRunResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();

  const { data: state } = await supabase
    .from('cinema_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();
  const batchId = state?.active_batch as string | undefined;
  if (!batchId) throw new Error('активной партии нет — сначала должна отработать перестройка');

  const wanted = await loadBatchImdbIds(supabase, batchId);
  if (wanted.size === 0) throw new Error('в активной партии нет ни одного imdb_id');

  const res = await fetch(DATASET_URL, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`выгрузка IMDb не отдалась: HTTP ${res.status}`);

  const lines = createInterface({
    input: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const found: { imdb_id: string; rating: number; votes: number; updated_at: string }[] = [];
  const now = new Date().toISOString();
  let scanned = 0;
  let headerChecked = false;
  for await (const line of lines) {
    if (!headerChecked) {
      headerChecked = true;
      if (line.startsWith(EXPECTED_HEADER)) continue;
      throw new Error(`шапка выгрузки IMDb не та, что ожидали: ${line.slice(0, 120)}`);
    }
    scanned++;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const tconst = line.slice(0, tab);
    if (!wanted.has(tconst)) continue;
    const [, avg, votes] = line.split('\t');
    const rating = Number(avg);
    if (!Number.isFinite(rating) || rating <= 0) continue;
    found.push({ imdb_id: tconst, rating: Math.round(rating * 10) / 10, votes: Number(votes) || 0, updated_at: now });
  }

  if (found.length < wanted.size * MIN_MATCH_RATIO) {
    throw new Error(
      `в выгрузке нашлось всего ${found.length} из ${wanted.size} тайтлов — похоже на смену формата, ничего не записываю`,
    );
  }

  for (let i = 0; i < found.length; i += UPSERT_CHUNK) {
    const { error } = await supabase
      .from('cinema_imdb_ratings')
      .upsert(found.slice(i, i + UPSERT_CHUNK), { onConflict: 'imdb_id' });
    if (error) throw new Error(`не записались оценки IMDb: ${error.message}`);
  }

  return { wanted: wanted.size, matched: found.length, scanned, durationMs: Date.now() - startedAt };
}

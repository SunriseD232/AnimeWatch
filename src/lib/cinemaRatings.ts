import { createServiceClient } from '@/lib/supabase/service';
import { mapWithConcurrency } from '@/lib/concurrency';
import { vlessDispatcher } from '@/lib/net/vlessProxy';

/**
 * Недельное обновление рейтингов TMDB для каталога кино (см. миграцию 0027).
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ ПЕРЕСТРОЙКИ. TMDB не отдаёт рейтинги пачкой — один
 * запрос на тайтл. На 103 тысячи тайтлов это 103 тысячи запросов, да ещё
 * через VLESS-туннель (api.themoviedb.org с этой VPS заблокирован по DNS,
 * см. lib/tmdb.ts). Внутри ночной перестройки это превратило бы её из
 * семиминутной в трёхчасовую, и любой сбой TMDB ронял бы весь каталог.
 *
 * Поэтому рейтинги живут в собственной таблице cinema_ratings, которая
 * перестройку ПЕРЕЖИВАЕТ, и обновляются своим кроном раз в неделю. В выдачу
 * свежий рейтинг попадает следующей ночью: перестройка копирует его в
 * cinema_index.rating (сортировать по присоединённой таблице через PostgREST
 * нельзя).
 *
 * Прогон ограничен бюджетом запросов, а не «всей базой»: трёхчасовой
 * процесс под PM2 — это заявка на то, что его прибьют посередине. Что не
 * успели — доберём на следующей неделе, порядок выбора это гарантирует.
 */

const TMDB_API = 'https://api.themoviedb.org/3';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Потолок запросов за один прогон. Замерено на боевом сервере: 15,5 запроса
 * в секунду через туннель, то есть 60 000 — это чуть больше часа. Уникальных
 * imdb_id в базе около 85 тысяч (у 93 тысяч тайтлов часть id общая), так что
 * полная база закрывается за два недельных прогона, дальше обновляются
 * только те, у кого отметка протухла.
 */
const DEFAULT_BUDGET = 60_000;

/** Одновременных запросов к TMDB. Официальный лимит там ~50 rps, но всё
 *  идёт через туннель, и упираться в него незачем. На 12 замерено 15,5 rps
 *  и ноль сетевых неудач на 300 запросах. */
const CONCURRENCY = 12;

/** Рейтинг считается свежим столько дней. */
const FRESH_DAYS = 30;

/**
 * Тайтлы, которых у TMDB нет, проверяются всё реже: базовая пауза умножается
 * на число неудач подряд. Иначе несколько тысяч ненаходимых записей съедали
 * бы бюджет каждого прогона, вытесняя те, где рейтинг реально есть.
 */
const MISS_BACKOFF_DAYS = 30;
const MAX_MISS_BACKOFF = 6;

/**
 * PostgREST отдаёт максимум 1000 строк за запрос.
 *
 * ВАЖНО про циклы чтения ниже — две грабли сразу, обе поймал вживую:
 *
 * 1. У постраничного запроса ОБЯЗАН быть order(). Без него Postgres не
 *    обещает никакого порядка между LIMIT/OFFSET-запросами, страницы
 *    перекрываются и часть строк не попадает НИ В ОДНУ: из 84 808 id
 *    вычитывалось то 45 793, то 55 841 — число плавало от прогона к прогону.
 * 2. Выходим только на пустой странице, а не на «пришло меньше, чем
 *    просили»: короткая страница не является признаком конца.
 */
const READ_PAGE = 1000;
const UPSERT_CHUNK = 500;

/**
 * Кандидаты обрабатываются порциями, и после каждой результат сразу
 * записывается. Иначе перезапуск PM2 посреди часового прогона выбрасывал бы
 * ВСЮ проделанную работу — а перезапуск за час вполне может случиться.
 */
const BATCH = 2000;

/**
 * Потолок по времени. Бюджет запросов задаёт «сколько», но не «как долго»:
 * если туннель просядет до пары запросов в секунду, 40 тысяч растянутся на
 * сутки и джоб застанет сам себя на следующей неделе.
 */
const MAX_RUN_MS = 100 * 60 * 1000;

interface TmdbHit {
  id: number;
  vote_average?: number;
  vote_count?: number;
  /** «Сколько смотрят прямо сейчас» — своя метрика TMDB, не производная от
   *  рейтинга. Приходит в том же ответе, отдельных запросов не стоит. */
  popularity?: number;
}

interface TmdbFindResult {
  movie_results?: TmdbHit[];
  tv_results?: TmdbHit[];
}

interface RatingRow {
  imdb_id: string;
  rating: number | null;
  votes: number | null;
  popularity: number | null;
  tmdb_id: number | null;
  media_type: string | null;
  checked_at: string;
  miss_count: number;
}

/**
 * Один поход в TMDB по IMDb id.
 *
 * cache: 'no-store' намеренно, в отличие от lib/tmdb.ts: там запросы
 * пользовательские и кэш Next экономит походы, а тут за прогон проходят
 * десятки тысяч разных id — кэшировать их значит сложить весь ответ TMDB в
 * память процесса.
 *
 * Возвращает null только при СЕТЕВОЙ неудаче (таймаут, 5xx, туннель лёг) —
 * такие не отмечаем как проверенные, чтобы они не выпали из очереди на
 * месяц. Честное «в TMDB такого нет» — это объект с rating: null.
 */
async function fetchRating(
  imdbId: string,
  apiKey: string,
): Promise<{
  rating: number | null;
  votes: number | null;
  popularity: number | null;
  tmdbId: number | null;
  mediaType: string | null;
} | null> {
  try {
    const res = await fetch(
      `${TMDB_API}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&api_key=${apiKey}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
        dispatcher: vlessDispatcher(),
      },
    );
    // 404 от TMDB — это ответ «не найдено», а не сбой: такой id больше
    // спрашивать смысла нет до истечения бэкоффа.
    if (res.status === 404) {
      return { rating: null, votes: null, popularity: null, tmdbId: null, mediaType: null };
    }
    if (!res.ok) return null;

    const data = (await res.json()) as TmdbFindResult;
    const movie = data.movie_results?.[0];
    const tv = data.tv_results?.[0];
    const hit = movie ?? tv;
    if (!hit) return { rating: null, votes: null, popularity: null, tmdbId: null, mediaType: null };

    const votes = hit.vote_count ?? 0;
    return {
      // 0.0 без единого голоса — не рейтинг, а его отсутствие: в сортировке
      // такие тайтлы должны уходить в конец вместе с непроверенными.
      rating: votes > 0 ? (hit.vote_average ?? null) : null,
      votes,
      popularity: typeof hit.popularity === 'number' ? hit.popularity : null,
      tmdbId: hit.id,
      mediaType: movie ? 'movie' : 'tv',
    };
  } catch {
    return null;
  }
}

/** Все imdb_id активной партии — постранично, только один столбец. */
async function loadBatchImdbIds(
  supabase: ReturnType<typeof createServiceClient>,
  batchId: string,
): Promise<string[]> {
  const out: string[] = [];

  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('cinema_index')
      .select('imdb_id')
      .eq('batch_id', batchId)
      .not('imdb_id', 'is', null)
      .order('kp_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);

    if (error) throw new Error(`не прочитать imdb_id партии: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const id = (r as { imdb_id: string | null }).imdb_id;
      if (id) out.push(id);
    }
  }

  return out;
}

/** Уже известные отметки — чтобы понять, что протухло, а что нет. */
async function loadKnownRatings(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<Map<string, { checkedAt: number; missCount: number; hasPopularity: boolean }>> {
  const out = new Map<string, { checkedAt: number; missCount: number; hasPopularity: boolean }>();

  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('cinema_ratings')
      .select('imdb_id, checked_at, miss_count, popularity, rating')
      .order('imdb_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);

    if (error) throw new Error(`не прочитать cinema_ratings: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const row = r as {
        imdb_id: string;
        checked_at: string;
        miss_count: number | null;
        popularity: number | null;
        rating: number | null;
      };
      out.set(row.imdb_id, {
        checkedAt: new Date(row.checked_at).getTime(),
        missCount: row.miss_count ?? 0,
        // Строка, у которой рейтинг есть, а популярности нет, записана до
        // того, как мы начали снимать popularity. Такие надо перепроверить
        // независимо от свежести отметки — иначе сортировка по популярности
        // месяц ждала бы истечения TTL.
        hasPopularity: row.popularity !== null || row.rating === null,
      });
    }
  }

  return out;
}

export interface RatingsRunResult {
  candidates: number;
  checked: number;
  updated: number;
  missed: number;
  failed: number;
  /** Прогон упёрся в потолок по времени, а не в бюджет запросов. */
  stoppedEarly: boolean;
  durationMs: number;
}

/**
 * Обновляет рейтинги для активной партии в пределах бюджета запросов.
 * Бросает только на том, что делает работу бессмысленной (нет ключа, нет
 * партии, БД недоступна) — отдельные неудачные запросы просто считаются.
 */
export async function refreshCinemaRatings(budget = DEFAULT_BUDGET): Promise<RatingsRunResult> {
  const startedAt = Date.now();
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('нет TMDB_API_KEY');

  const supabase = createServiceClient();

  await supabase
    .from('cinema_index_state')
    .update({ ratings_run_started_at: new Date().toISOString(), ratings_error: null })
    .eq('id', true);

  const { data: state } = await supabase
    .from('cinema_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();

  const batchId = state?.active_batch as string | undefined;
  // Без построенного индекса обновлять нечего: список тайтлов берётся именно
  // из него, а не из апстрима — лишний повод не жечь квоту Videoseed.
  if (!batchId) throw new Error('активной партии нет — сначала должна отработать перестройка');

  const imdbIds = await loadBatchImdbIds(supabase, batchId);
  const known = await loadKnownRatings(supabase);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Кандидаты: ни разу не проверенные — вперёд, дальше самые несвежие.
  // Сортировка именно такая, чтобы за несколько недельных прогонов база
  // закрылась целиком, а не крутилась по одному и тому же началу списка.
  const candidates: { imdbId: string; checkedAt: number }[] = [];
  const seen = new Set<string>();

  for (const imdbId of imdbIds) {
    if (seen.has(imdbId)) continue;
    seen.add(imdbId);

    const prev = known.get(imdbId);
    if (!prev) {
      candidates.push({ imdbId, checkedAt: 0 });
      continue;
    }
    if (!prev.hasPopularity) {
      candidates.push({ imdbId, checkedAt: prev.checkedAt });
      continue;
    }
    const backoff = Math.min(prev.missCount, MAX_MISS_BACKOFF) * MISS_BACKOFF_DAYS;
    const ttl = (FRESH_DAYS + backoff) * day;
    if (now - prev.checkedAt >= ttl) {
      candidates.push({ imdbId, checkedAt: prev.checkedAt });
    }
  }

  candidates.sort((a, b) => a.checkedAt - b.checkedAt);
  const slice = candidates.slice(0, budget);

  let updated = 0;
  let missed = 0;
  let failed = 0;
  let checked = 0;
  let stoppedEarly = false;

  for (let offset = 0; offset < slice.length; offset += BATCH) {
    if (Date.now() - startedAt > MAX_RUN_MS) {
      stoppedEarly = true;
      break;
    }

    const part = slice.slice(offset, offset + BATCH);
    const results = await mapWithConcurrency(part, CONCURRENCY, (c) =>
      fetchRating(c.imdbId, apiKey),
    );

    const rows: RatingRow[] = [];
    for (let i = 0; i < part.length; i++) {
      const imdbId = part[i].imdbId;
      const res = results[i];

      // Сетевая неудача — НЕ отмечаем проверенным: иначе тайтл выпал бы из
      // очереди на месяц из-за одного моргнувшего туннеля.
      if (res === null) {
        failed++;
        continue;
      }

      const prevMiss = known.get(imdbId)?.missCount ?? 0;
      if (res.rating === null) missed++;
      else updated++;

      rows.push({
        imdb_id: imdbId,
        rating: res.rating,
        votes: res.votes,
        popularity: res.popularity,
        tmdb_id: res.tmdbId,
        media_type: res.mediaType,
        checked_at: new Date().toISOString(),
        miss_count: res.rating === null ? prevMiss + 1 : 0,
      });
    }

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from('cinema_ratings')
        .upsert(chunk, { onConflict: 'imdb_id' });
      if (error) throw new Error(`не записались рейтинги: ${error.message}`);
    }

    checked += part.length;

    // Отметка прогресса после каждой порции: часовой джоб, о котором ничего
    // не известно до самого конца, отлаживать нечем.
    await supabase
      .from('cinema_index_state')
      .update({ ratings_checked: checked })
      .eq('id', true);
  }

  await supabase
    .from('cinema_index_state')
    .update({
      ratings_run_finished_at: new Date().toISOString(),
      ratings_checked: checked,
      ratings_error: stoppedEarly ? `остановлен по таймауту после ${checked} проверок` : null,
    })
    .eq('id', true);

  return {
    candidates: candidates.length,
    checked,
    updated,
    missed,
    failed,
    stoppedEarly,
    durationMs: Date.now() - startedAt,
  };
}

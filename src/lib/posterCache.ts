import { mkdir, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/service';
import { mapWithConcurrency } from '@/lib/concurrency';
import { getYummyPostersMap } from '@/lib/video/yummy';
import type { PosterKind } from '@/lib/posterPath';

/**
 * Локальный кэш постеров (см. миграцию 0029).
 *
 * ЗАЧЕМ. Обложки приходят из трёх чужих мест, и каждое — своя задержка и
 * своя точка отказа: shikimori.io для каталога аниме, yani.tv для главной
 * (туда подменяются обложки там, где у Shikimori плейсхолдер) и
 * api.videoseed.tv для кино. Последнее — худший случай: постер идёт через
 * НАШ прокси /api/proxy/raw, который на каждый запрос заново качает картинку
 * с Videoseed и заново жмёт её в WebP через sharp, без дискового кэша.
 *
 * После этого модуля вся страница берёт обложки с нашего же диска одним
 * коротким запросом. Заодно это лечит 404 от чужих CDN: файл лежит у нас.
 *
 * Замерено на боевом сервере: 144 КБ оригинал аниме → 47 КБ WebP-480,
 * 48 КБ оригинал кино → 18 КБ. Весь каталог — около 2,8 ГБ.
 */

/** Куда складываем. По подпапке на раздел: posters/anime, posters/cinema. */
const POSTER_DIR = process.env.POSTER_DIR ?? '/opt/mediawatch/posters';

/**
 * Ширина, в которую пережимаем. Карточка каталога — от 139 до 187 CSS-
 * пикселей, постер на странице тайтла — 192. 480 покрывает всё это с запасом
 * на экраны двойной плотности и не тратит место впустую: у кино исходник
 * и так 240x320, увеличивать его незачем (withoutEnlargement).
 */
const TARGET_WIDTH = 480;
const WEBP_QUALITY = 82;

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 20_000;

/** Потолок за один прогон и по числу картинок, и по времени. */
const DEFAULT_BUDGET = 20_000;
const MAX_RUN_MS = 60 * 60 * 1000;

/** Перекачиваем не чаще этого, если ссылка у апстрима не менялась. */
const FRESH_DAYS = 180;

/** Битые ссылки пробуем всё реже: пауза множится на число неудач подряд. */
const MISS_BACKOFF_DAYS = 14;
const MAX_MISS_BACKOFF = 8;

/** PostgREST отдаёт максимум 1000 строк за запрос. */
const READ_PAGE = 1000;
const WRITE_CHUNK = 500;

/** Пачка, после которой пишем результат в базу. Прогон длинный, и терять
 *  час работы из-за рестарта PM2 незачем — та же причина, что в
 *  lib/cinemaRatings.ts. */
const BATCH = 1000;

export type { PosterKind };

function filePath(kind: PosterKind, id: number): string {
  return join(POSTER_DIR, kind, `${id}.webp`);
}

interface Candidate {
  id: number;
  url: string;
}

interface CacheRow {
  kind: string;
  source_id: number;
  source_url: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  fetched_at: string;
  miss_count: number;
}

/**
 * Скачивает и пережимает одну обложку.
 *
 * Возвращает null при СЕТЕВОЙ неудаче — такие не отмечаем проверенными,
 * иначе моргнувший апстрим отправил бы тайтл в бэкофф на две недели.
 */
async function fetchAndStore(
  kind: PosterKind,
  id: number,
  url: string,
): Promise<{ bytes: number; width: number | null; height: number | null } | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      // Shikimori режет хотлинк по Referer — тот же приём, что у <img> в
      // карточках (см. components/PosterImage.tsx).
      headers: { 'User-Agent': 'MediaWatch MVP', Referer: '' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // 404 — честный ответ «такой картинки нет», а не сбой: имеет смысл
    // запомнить неудачу и не долбиться сюда каждую ночь.
    if (res.status === 404 || res.status === 403) {
      return { bytes: 0, width: null, height: null };
    }
    if (!res.ok) return null;

    const input = Buffer.from(await res.arrayBuffer());
    if (input.length === 0) return { bytes: 0, width: null, height: null };

    const output = await sharp(input)
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    const target = filePath(kind, id);
    await mkdir(dirname(target), { recursive: true });
    // Пишем во временный файл и переименовываем: rename в пределах одной
    // файловой системы атомарен, поэтому nginx никогда не увидит
    // недописанный файл, даже если процесс убьют посреди записи.
    const tmp = `${target}.tmp`;
    await writeFile(tmp, output.data);
    await rename(tmp, target);

    return {
      bytes: output.data.length,
      width: output.info.width ?? null,
      height: output.info.height ?? null,
    };
  } catch {
    return null;
  }
}

/** Кандидаты из активной партии: id + ссылка на обложку у апстрима. */
async function loadCandidates(
  supabase: ReturnType<typeof createServiceClient>,
  kind: PosterKind,
): Promise<Candidate[]> {
  const table = kind === 'anime' ? 'anime_index' : 'cinema_index';
  const stateTable = kind === 'anime' ? 'anime_index_state' : 'cinema_index_state';
  const idColumn = kind === 'anime' ? 'shikimori_id' : 'kp_id';
  const urlColumns = kind === 'anime' ? 'poster_original, poster_preview' : 'poster';

  const { data: state } = await supabase
    .from(stateTable)
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();

  const batchId = state?.active_batch as string | undefined;
  if (!batchId) throw new Error(`нет активной партии ${kind} — сначала должна отработать перестройка`);

  const out: Candidate[] = [];

  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(`${idColumn}, ${urlColumns}`)
      .eq('batch_id', batchId)
      // order() обязателен: без него Postgres не обещает порядок между
      // LIMIT/OFFSET-запросами и страницы перекрываются (обжёгся на этом в
      // lib/cinemaRatings.ts — вычитывалась половина базы).
      .order(idColumn, { ascending: true })
      .range(from, from + READ_PAGE - 1);

    if (error) throw new Error(`не прочитать ${table}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const row = r as unknown as Record<string, unknown>;
      const id = Number(row[idColumn]);
      const url =
        kind === 'anime'
          ? ((row.poster_original as string | null) ?? (row.poster_preview as string | null))
          : (row.poster as string | null);
      if (Number.isFinite(id) && id > 0 && url) out.push({ id, url });
    }
  }

  return out;
}

/**
 * Все id, у которых обложка реально лежит на диске. Нужен ночным
 * перестройкам: новая партия должна унаследовать флаг poster_local, иначе
 * после каждой перестройки весь каталог на сутки возвращался бы к чужим CDN,
 * хотя файлы никуда не делись.
 */
export async function loadStoredPosterIds(
  supabase: ReturnType<typeof createServiceClient>,
  kind: PosterKind,
): Promise<Set<number>> {
  const out = new Set<number>();

  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('poster_cache')
      .select('source_id')
      .eq('kind', kind)
      .gt('bytes', 0)
      .order('source_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);

    // Не бросаем: без флага каталог просто отдаст ссылки на апстрим.
    if (error) {
      console.error('[posterCache] не прочитать список скачанных:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) out.add((r as { source_id: number }).source_id);
  }

  return out;
}

/** Что уже скачано — чтобы не качать заново. */
async function loadCached(
  supabase: ReturnType<typeof createServiceClient>,
  kind: PosterKind,
): Promise<Map<number, { url: string | null; fetchedAt: number; missCount: number; ok: boolean }>> {
  const out = new Map<number, { url: string | null; fetchedAt: number; missCount: number; ok: boolean }>();

  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from('poster_cache')
      .select('source_id, source_url, bytes, fetched_at, miss_count')
      .eq('kind', kind)
      .order('source_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);

    if (error) throw new Error(`не прочитать poster_cache: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const row = r as {
        source_id: number;
        source_url: string | null;
        bytes: number | null;
        fetched_at: string;
        miss_count: number | null;
      };
      out.set(row.source_id, {
        url: row.source_url,
        fetchedAt: new Date(row.fetched_at).getTime(),
        missCount: row.miss_count ?? 0,
        ok: (row.bytes ?? 0) > 0,
      });
    }
  }

  return out;
}

/**
 * Постеры Yummy для аниме. У Shikimori часть тайтлов с плейсхолдером вместо
 * обложки, и главная поэтому давно показывает картинки Yummy (см.
 * withYummyPosters в lib/shikimori.ts). Кэшируем ту же картинку, что видит
 * пользователь, иначе локальная копия оказалась бы хуже той, что была.
 *
 * Необязательный шаг: Yummy не ответил — качаем с Shikimori.
 */
const YUMMY_CHUNK = 100;

async function loadYummyPosters(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();

  for (let i = 0; i < ids.length; i += YUMMY_CHUNK) {
    const chunk = ids.slice(i, i + YUMMY_CHUNK);
    try {
      const map = await getYummyPostersMap(chunk);
      for (const [id, url] of map) out.set(id, url);
    } catch {
      // Пропускаем пачку: у этих тайтлов останется постер Shikimori.
    }
  }

  return out;
}

export interface PosterCacheResult {
  kind: PosterKind;
  candidates: number;
  attempted: number;
  stored: number;
  missed: number;
  failed: number;
  bytes: number;
  stoppedEarly: boolean;
  durationMs: number;
}

export async function cachePosters(
  kind: PosterKind,
  budget = DEFAULT_BUDGET,
): Promise<PosterCacheResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();

  const candidates = await loadCandidates(supabase, kind);
  const cached = await loadCached(supabase, kind);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Что качать: незнакомые, те, у кого апстрим сменил ссылку (в ней хеш
  // файла — значит, обложку заменили), и протухшие.
  const todo: Candidate[] = [];
  for (const c of candidates) {
    const prev = cached.get(c.id);
    if (!prev) {
      todo.push(c);
      continue;
    }
    if (prev.url !== c.url) {
      todo.push(c);
      continue;
    }
    const backoff = prev.ok ? 0 : Math.min(prev.missCount, MAX_MISS_BACKOFF) * MISS_BACKOFF_DAYS;
    const ttl = (prev.ok ? FRESH_DAYS : MISS_BACKOFF_DAYS + backoff) * day;
    if (now - prev.fetchedAt >= ttl) todo.push(c);
  }

  // Сначала те, кого не качали ни разу: первый прогон должен закрыть как
  // можно больше пустых карточек, а не обновлять уже лежащие.
  todo.sort((a, b) => (cached.has(a.id) ? 1 : 0) - (cached.has(b.id) ? 1 : 0));
  const slice = todo.slice(0, budget);

  // Для аниме предпочитаем обложку Yummy — ту же, что показывает главная.
  const yummy =
    kind === 'anime' ? await loadYummyPosters(slice.map((c) => c.id)) : new Map<number, string>();

  let stored = 0;
  let missed = 0;
  let failed = 0;
  let bytes = 0;
  let attempted = 0;
  let stoppedEarly = false;

  for (let offset = 0; offset < slice.length; offset += BATCH) {
    if (Date.now() - startedAt > MAX_RUN_MS) {
      stoppedEarly = true;
      break;
    }

    const part = slice.slice(offset, offset + BATCH);
    const results = await mapWithConcurrency(part, CONCURRENCY, async (c) => {
      const url = yummy.get(c.id) ?? c.url;
      const res = await fetchAndStore(kind, c.id, url);
      // Yummy подвёл — пробуем родную ссылку из индекса, она почти всегда
      // жива. Без этого подмена постера ухудшала бы покрытие.
      if ((res === null || res.bytes === 0) && url !== c.url) {
        const fallback = await fetchAndStore(kind, c.id, c.url);
        if (fallback && fallback.bytes > 0) return { url: c.url, res: fallback };
      }
      return { url, res };
    });

    const rows: CacheRow[] = [];
    const okIds: number[] = [];

    for (let i = 0; i < part.length; i++) {
      const { res } = results[i];
      attempted++;

      if (res === null) {
        failed++;
        continue;
      }
      if (res.bytes === 0) {
        missed++;
      } else {
        stored++;
        bytes += res.bytes;
        okIds.push(part[i].id);
      }

      rows.push({
        kind,
        source_id: part[i].id,
        // Пишем ссылку ИЗ ИНДЕКСА, а не ту, по которой скачали. Проверка
        // свежести выше сравнивает сохранённое значение с индексом, а
        // скачиваем мы, когда можем, с Yummy (см. loadYummyPosters) — и
        // запись его ссылки означала вечное расхождение: каждую ночь все
        // такие тайтлы считались «апстрим сменил обложку» и качались
        // заново. На проде это давало 10 251 повторную закачку и 472 МБ
        // трафика за прогон вместо десятков новых.
        source_url: part[i].url,
        bytes: res.bytes,
        width: res.width,
        height: res.height,
        fetched_at: new Date().toISOString(),
        miss_count: res.bytes === 0 ? (cached.get(part[i].id)?.missCount ?? 0) + 1 : 0,
      });
    }

    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      const { error } = await supabase
        .from('poster_cache')
        .upsert(chunk, { onConflict: 'kind,source_id' });
      if (error) throw new Error(`не записался poster_cache: ${error.message}`);
    }

    await markLocal(supabase, kind, okIds);
  }

  return {
    kind,
    candidates: todo.length,
    attempted,
    stored,
    missed,
    failed,
    bytes,
    stoppedEarly,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Ставит флаг poster_local в самой партии индекса — чтобы страница каталога
 * решала, какую ссылку отдать, одним запросом, без join'а по 24 карточкам.
 *
 * Обновляем сразу, а не ждём ночной перестройки: иначе только что скачанные
 * обложки лежали бы на диске мёртвым грузом до утра.
 *
 * Тонкость: если перестройка идёт ОДНОВРЕМЕННО с этим прогоном, часть флагов
 * не доедет — строка новой партии вставляется после того, как markLocal по
 * ней уже отработал (наступил на это, запустив оба вручную: 12 тысяч файлов
 * лежали на диске без флага). Само чинится следующей перестройкой, она
 * берёт флаги из poster_cache. В штатном расписании они и не пересекаются:
 * перестройки в 5:00 и 5:20, докачка обложек в 5:40.
 */
async function markLocal(
  supabase: ReturnType<typeof createServiceClient>,
  kind: PosterKind,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;

  const table = kind === 'anime' ? 'anime_index' : 'cinema_index';
  const idColumn = kind === 'anime' ? 'shikimori_id' : 'kp_id';

  for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
    const chunk = ids.slice(i, i + WRITE_CHUNK);
    const { error } = await supabase
      .from(table)
      .update({ poster_local: true })
      .in(idColumn, chunk);
    // Не бросаем: файл уже лежит, флаг проставится при следующей перестройке.
    if (error) console.error(`[posterCache] не проставился poster_local в ${table}:`, error.message);
  }
}

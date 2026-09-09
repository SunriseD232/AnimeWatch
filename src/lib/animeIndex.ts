import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { loadStoredPosterIds } from '@/lib/posterCache';

/**
 * Построение локального индекса каталога аниме (см. миграцию 0025).
 *
 * Источник — GraphQL Shikimori, а не REST. Причины две. Во-первых, только он
 * знает актуальную таксономию: REST /genres отдаёт легаси-список из 46
 * записей, где «Магия» есть, но не находит ничего, а «Изекая» и «Махо-сёдзё»
 * нет вовсе. Во-вторых, он отдаёт жанры ПРЯМО В СПИСКЕ — 50 тайтлов за
 * запрос вместе с жанрами, типом, статусом, числом серий, годом и рейтингом.
 * Через REST то же самое стоило бы 24 тысячи запросов за полными карточками
 * вместо ~480.
 *
 * Перезакачка полная, с нуля, но живая таблица при этом не опустошается ни
 * на секунду: строки пишутся со своим batch_id, и указатель на активную
 * партию переключается только после того, как закачка целиком удалась и
 * прошла проверку на вменяемость. Оборвалась на середине — читатели
 * продолжают видеть прошлую партию, а мусорные строки удаляются.
 */

// ВАЖНО: именно shikimori.io, как и у REST-клиента (см. комментарий про
// переезд домена в lib/shikimori.ts). shikimori.one с продакшен-VPS не
// открывается ВООБЩЕ — connect timeout, а не редирект, — и ночная
// перестройка падала на первом же запросе с «fetch failed». С машины
// разработчика .one при этом отвечает, поэтому локально всё выглядело
// исправным; проверено на сервере вживую.
const GRAPHQL_URL = 'https://shikimori.io/api/graphql';
const USER_AGENT = 'MediaWatch MVP';

/** GraphQL Shikimori больше 50 за запрос не отдаёт. */
const PAGE_SIZE = 50;

/**
 * Пауза между запросами. Лимит Shikimori — 5 rps И 90 запросов в минуту;
 * ограничивает именно второе: 700 мс дают ~85 rpm, то есть весь каталог
 * (~480 страниц) выкачивается за ~6 минут, не подходя к границе вплотную.
 * Гнать на 5 rps здесь нельзя — на такой длинной серии это гарантированный
 * бан по минутному лимиту.
 */
const REQUEST_INTERVAL_MS = 700;

/** Предохранитель от бесконечного цикла, если апстрим начнёт отдавать
 *  непустые страницы бесконечно. 24k тайтлов — это ~480 страниц. */
const MAX_PAGES = 900;

/** Партия меньше этого — точно обрыв, а не «каталог усох». Меняем указатель
 *  только если новая партия не потеряла больше пятой части прошлой. */
const MIN_SANE_TITLES = 5000;
const MAX_SHRINK_RATIO = 0.8;

const MAX_ATTEMPTS = 3;

interface GqlGenre {
  id: string;
  name: string;
  russian: string;
  kind: string;
}

interface GqlAnime {
  id: string;
  name: string | null;
  russian: string | null;
  kind: string | null;
  status: string | null;
  rating: string | null;
  episodes: number | null;
  episodesAired: number | null;
  airedOn: { date: string | null; year: number | null } | null;
  releasedOn: { date: string | null } | null;
  score: number | null;
  description: string | null;
  poster: { originalUrl: string | null; previewUrl: string | null } | null;
  genres: { id: string }[] | null;
}

/**
 * Описание у Shikimori приходит в их собственной разметке: [[ссылка]] на
 * другую сущность, [b]...[/b], [character=123]имя[/character] и прочее.
 * В карточке каталога нужен чистый текст — иначе пользователь читает
 * квадратные скобки вперемешку с сюжетом.
 */
function stripShikimoriMarkup(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw
    // [[id|подпись]] — оставляем подпись, [[Синигами]] — само слово.
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    // Остальные теги ([b], [character=123], [/i] и прочие) просто снимаем,
    // оставляя то, что между ними. Парного сопоставления с обратной ссылкой
    // тут сознательно нет: оно ничего не добавляет — внутренний текст
    // сохраняется и так, — зато легко ломается при правках.
    .replace(/\[\/?\w+(?:=[^\]]*)?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

async function gql<T>(query: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
      if (!json.data) throw new Error('пустой data в ответе');

      return json.data;
    } catch (err) {
      lastError = err;
      // Пауза растёт с попытками: сетевой сбой лечится сразу, а упор в
      // лимит апстрима — только ожиданием.
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 3000);
    }
  }

  throw new Error(`GraphQL не ответил за ${MAX_ATTEMPTS} попытки: ${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Актуальная таксономия: 22 жанра + 53 темы + 5 демографий. */
async function fetchTaxonomy(): Promise<GqlGenre[]> {
  const data = await gql<{ genres: GqlGenre[] }>(
    '{ genres(entryType: Anime) { id name russian kind } }',
  );
  return data.genres ?? [];
}

const ANIME_FIELDS = `
  id name russian kind status rating episodes episodesAired
  airedOn { date year }
  releasedOn { date }
  score description
  poster { originalUrl previewUrl }
  genres { id }
`;

/**
 * Страница каталога. Сортировка по id намеренно: она стабильна, поэтому
 * тайтл, добавленный на Shikimori ПОСРЕДИ обхода, не сдвигает уже пройденные
 * страницы и не выбивает соседей из выдачи. При сортировке по рейтингу или
 * популярности такой тайтл сдвинул бы всё за собой, и ровно один тайтл на
 * границе страницы терялся бы на каждой вставке.
 */
async function fetchPage(page: number): Promise<GqlAnime[]> {
  const data = await gql<{ animes: GqlAnime[] }>(
    `{ animes(limit: ${PAGE_SIZE}, page: ${page}, order: id) { ${ANIME_FIELDS} } }`,
  );
  return data.animes ?? [];
}

interface IndexRow {
  batch_id: string;
  shikimori_id: number;
  name: string | null;
  russian: string | null;
  kind: string | null;
  status: string | null;
  rating: string | null;
  episodes: number;
  episodes_aired: number;
  episodes_effective: number;
  aired_on: string | null;
  released_on: string | null;
  aired_year: number | null;
  score: number | null;
  description: string | null;
  popularity_rank: number | null;
  poster_original: string | null;
  poster_preview: string | null;
  genre_ids: number[];
  poster_local: boolean;
}

/**
 * Второй проход: снимает позиции в сортировке по популярности. Отдельным
 * проходом, потому что основной идёт по id — только такая сортировка
 * стабильна, и тайтл, добавленный ПОСРЕДИ обхода, не сдвигает уже пройденные
 * страницы и никого не выбивает из выдачи. Сортировка по популярности этим
 * свойством не обладает совсем, зато поля популярности GraphQL не отдаёт
 * (ни popularity, ни userRatesStats на типе Anime нет), а сортировать по ней
 * умеет — вот и снимаем одни только id.
 *
 * Проход необязательный: если он упадёт, партия всё равно поедет в дело, а
 * сортировка «По популярности» просто отработает по прошлым рангам (их нет —
 * тайтлы уйдут в конец). Ронять из-за неё всю ночную перестройку незачем.
 */
async function fetchPopularityRanks(): Promise<Map<number, number>> {
  const ranks = new Map<number, number>();
  let page = 1;

  while (page <= MAX_PAGES) {
    const data = await gql<{ animes: { id: string }[] }>(
      `{ animes(limit: ${PAGE_SIZE}, page: ${page}, order: popularity) { id } }`,
    );
    const batch = data.animes ?? [];
    if (batch.length === 0) break;

    for (const a of batch) {
      const id = Number(a.id);
      // Первое вхождение и выигрывает: если апстрим переставил что-то во
      // время обхода и тайтл встретился дважды, ранг повыше вернее.
      if (Number.isFinite(id) && !ranks.has(id)) ranks.set(id, ranks.size + 1);
    }

    page++;
    if (batch.length < PAGE_SIZE) break;
    await sleep(REQUEST_INTERVAL_MS);
  }

  return ranks;
}

function toRow(
  a: GqlAnime,
  batchId: string,
  ranks: Map<number, number>,
  storedPosters: Set<number>,
): IndexRow | null {
  const id = Number(a.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    batch_id: batchId,
    shikimori_id: id,
    name: a.name,
    russian: a.russian,
    kind: a.kind,
    status: a.status,
    rating: a.rating,
    episodes: a.episodes ?? 0,
    episodes_aired: a.episodesAired ?? 0,
    // Ноль = «неизвестно», см. комментарий к колонке в миграции 0025.
    episodes_effective:
      a.status === 'ongoing' && (a.episodesAired ?? 0) > 0
        ? (a.episodesAired as number)
        : (a.episodes ?? 0) > 0
          ? (a.episodes as number)
          : (a.episodesAired ?? 0),
    aired_on: a.airedOn?.date ?? null,
    released_on: a.releasedOn?.date ?? null,
    aired_year: a.airedOn?.year ?? null,
    // score приходит числом, но 0 у Shikimori означает «оценок нет» —
    // пишем null, иначе сортировка по рейтингу поднимала бы такие тайтлы
    // наравне с честными нулями (которых не бывает).
    score: a.score && a.score > 0 ? a.score : null,
    description: stripShikimoriMarkup(a.description),
    popularity_rank: ranks.get(id) ?? null,
    poster_original: a.poster?.originalUrl ?? null,
    poster_preview: a.poster?.previewUrl ?? null,
    genre_ids: (a.genres ?? [])
      .map((g) => Number(g.id))
      .filter((n) => Number.isFinite(n) && n > 0),
    // Флаг наследуется от долгоживущего кэша обложек (миграция 0029): файлы
    // перестройку переживают, и терять их на сутки незачем.
    poster_local: storedPosters.has(id),
  };
}

export interface ReindexResult {
  titles: number;
  genres: number;
  ranked: number;
  pages: number;
  durationMs: number;
  batchId: string;
}

/** Сколько строк отправляем в Supabase за раз. 500 × ~400 байт — около
 *  200 КБ на запрос, комфортно и для PostgREST, и по памяти. */
const INSERT_CHUNK = 500;

/**
 * Полная перестройка индекса. Возвращает статистику или бросает — вызывающий
 * (крон-роут) пишет исход в anime_index_state.
 */
export async function rebuildAnimeIndex(): Promise<ReindexResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const batchId = randomUUID();

  await supabase
    .from('anime_index_state')
    .update({ last_run_started_at: new Date().toISOString(), last_error: null })
    .eq('id', true);

  // ── Уборка за прошлыми неудачами ──
  // Прогон, упавший ПОСЛЕ начала вставки, оставляет свои строки навсегда:
  // discardBatch ниже срабатывает только при провале проверки на усадку или
  // после успешного переключения, а до него в таких случаях не доходит.
  // Поэтому чистим здесь всё, что не является активной партией: активную не
  // трогаем (её прямо сейчас читает каталог), а всё остальное — заведомо
  // мусор от оборвавшихся попыток.
  const { data: before } = await supabase
    .from('anime_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();

  if (before?.active_batch) {
    const { error } = await supabase
      .from('anime_index')
      .delete()
      .neq('batch_id', before.active_batch);
    if (error) console.error('[animeIndex] уборка старых партий не удалась:', error.message);
  } else {
    // Активной партии нет вовсе (первый запуск или прошлый упал до
    // переключения) — чистить можно всё, читателям сейчас всё равно нечего
    // показывать из индекса, они на запасном пути через Shikimori.
    const { error } = await supabase.from('anime_index').delete().not('batch_id', 'is', null);
    if (error) console.error('[animeIndex] уборка перед первой сборкой не удалась:', error.message);
  }

  // ── Таксономия ──
  const taxonomy = await fetchTaxonomy();
  if (taxonomy.length === 0) throw new Error('таксономия пришла пустой');

  const { error: genresError } = await supabase.from('anime_genres').upsert(
    taxonomy.map((g) => ({
      id: Number(g.id),
      name: g.name,
      russian: g.russian,
      kind: g.kind,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'id' },
  );
  if (genresError) throw new Error(`не записалась таксономия: ${genresError.message}`);

  // Пункты, исчезнувшие из таксономии, убираем — иначе в панели фильтров
  // навсегда останется мёртвая кнопка вроде той самой «Магии».
  const liveGenreIds = taxonomy.map((g) => Number(g.id));
  await supabase.from('anime_genres').delete().not('id', 'in', `(${liveGenreIds.join(',')})`);

  // ── Ранги популярности ──
  // До основного обхода, чтобы проставлять их сразу при вставке и не идти
  // вторым проходом по уже записанным строкам. Необязательный шаг: упал —
  // просто теряем сортировку «По популярности» до следующей ночи, ронять
  // из-за неё всю перестройку незачем.
  let ranks = new Map<number, number>();
  try {
    ranks = await fetchPopularityRanks();
  } catch (err) {
    console.error(
      '[animeIndex] ранги популярности снять не удалось, продолжаю без них:',
      err instanceof Error ? err.message : err,
    );
  }

  const storedPosters = await loadStoredPosterIds(supabase, 'anime');

  // ── Тайтлы ──
  let page = 1;
  let titles = 0;
  const seen = new Set<number>();

  while (page <= MAX_PAGES) {
    const batch = await fetchPage(page);
    if (batch.length === 0) break;

    const rows: IndexRow[] = [];
    for (const item of batch) {
      const row = toRow(item, batchId, ranks, storedPosters);
      // Дубли между страницами возможны, если апстрим что-то переставил
      // прямо во время обхода; первичный ключ бы на них упал.
      if (row && !seen.has(row.shikimori_id)) {
        seen.add(row.shikimori_id);
        rows.push(row);
      }
    }

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const { error } = await supabase.from('anime_index').insert(chunk);
      if (error) throw new Error(`вставка страницы ${page} упала: ${error.message}`);
    }

    titles += rows.length;
    page++;

    if (batch.length < PAGE_SIZE) break; // апстрим исчерпан
    await sleep(REQUEST_INTERVAL_MS);
  }

  // ── Проверка на вменяемость до переключения ──
  const { data: state } = await supabase
    .from('anime_index_state')
    .select('titles_count, active_batch')
    .eq('id', true)
    .maybeSingle();

  const previous = state?.titles_count ?? 0;

  if (titles < MIN_SANE_TITLES) {
    await discardBatch(supabase, batchId);
    throw new Error(`собрано всего ${titles} тайтлов — похоже на обрыв, партия отброшена`);
  }
  if (previous > 0 && titles < previous * MAX_SHRINK_RATIO) {
    await discardBatch(supabase, batchId);
    throw new Error(
      `новая партия ${titles} против прошлой ${previous} — усадка больше допустимой, партия отброшена`,
    );
  }

  // ── Переключение ──
  // Один UPDATE одной строки: читатели видят либо старую партию целиком,
  // либо новую целиком.
  const previousBatch = state?.active_batch ?? null;
  const { error: swapError } = await supabase
    .from('anime_index_state')
    .update({
      active_batch: batchId,
      built_at: new Date().toISOString(),
      titles_count: titles,
      last_run_finished_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', true);
  if (swapError) throw new Error(`не переключился указатель партии: ${swapError.message}`);

  // Старая партия больше не нужна. Если удаление не удастся — не страшно,
  // следующий запуск подчистит: лишние строки никому не видны, читатели
  // фильтруют по active_batch.
  if (previousBatch) await discardBatch(supabase, previousBatch);

  return {
    titles,
    genres: taxonomy.length,
    ranked: ranks.size,
    pages: page - 1,
    durationMs: Date.now() - startedAt,
    batchId,
  };
}

async function discardBatch(
  supabase: ReturnType<typeof createServiceClient>,
  batchId: string,
): Promise<void> {
  const { error } = await supabase.from('anime_index').delete().eq('batch_id', batchId);
  if (error) console.error('[animeIndex] не удалось удалить партию', batchId, error.message);
}

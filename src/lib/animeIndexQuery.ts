import { createClient } from '@/lib/supabase/server';
import { DEFAULT_KINDS, type TriState } from '@/lib/animeFilters';
import { localPosterUrl } from '@/lib/posterCacheQuery';
import type { AnimeCatalogPage, AnimeCatalogParams, ShikimoriAnimeShort } from '@/lib/shikimori';

/**
 * Чтение каталога из локального индекса (см. миграцию 0025, lib/animeIndex.ts).
 *
 * Ради чего всё затевалось: тут весь фильтр — один SQL-запрос. Через
 * Shikimori AND и исключение по жанрам шли «медленным путём» с догрузкой
 * полных карточек по одной и потолком в 120 штук, из-за чего редкие
 * комбинации отдавали мало результатов не потому, что их нет, а потому что
 * кончался бюджет запросов. Числа серий как фильтра у API v1 нет вовсе.
 *
 * Возвращает null, если индекса ещё нет — вызывающий откатывается на старый
 * путь через Shikimori. Это нужно и в первые минуты после раскатки, пока
 * ночной крон ни разу не отработал, и как страховка, если индекс опустеет.
 *
 * ВАЖНО: функции отсюда НИКОГДА не бросают. Исключение (нет таблиц, отвалился
 * Supabase) отменило бы откат — вызывающий поймал бы его своим catch и показал
 * ошибку вместо того, чтобы просто сходить в Shikimori. Ровно на это я и
 * напоролся локально: не оказалось ключа, createServiceClient бросил, и панель
 * фильтров осталась вовсе без жанров.
 *
 * Читаем обычным клиентом с сессией пользователя, а не service_role: таблицы
 * индекса — публичные данные каталога с политикой чтения для всех (миграция
 * 0025), и брать под это ключ, обходящий RLS, незачем. Пишет их только крон.
 */

/** Строка индекса ровно в том виде, в каком её отдаёт PostgREST. */
interface IndexRow {
  shikimori_id: number;
  name: string | null;
  russian: string | null;
  kind: string | null;
  status: string | null;
  episodes: number;
  episodes_aired: number;
  aired_on: string | null;
  released_on: string | null;
  score: number | null;
  poster_original: string | null;
  poster_preview: string | null;
  description: string | null;
  poster_local: boolean | null;
}

/** Индекс хранит ровно те поля, что нужны карточке, но остальное приложение
 *  говорит на языке ShikimoriAnimeShort — переводим здесь, чтобы ни
 *  AnimeCard, ни страницы про подмену источника не знали. */
function toShort(row: IndexRow): ShikimoriAnimeShort {
  const preview = row.poster_preview ?? row.poster_original ?? '';
  const original = row.poster_original ?? row.poster_preview ?? '';

  return {
    id: row.shikimori_id,
    name: row.name ?? '',
    russian: row.russian ?? row.name ?? '',
    image: { original, preview, x96: preview, x48: preview },
    url: `/animes/${row.shikimori_id}`,
    kind: row.kind,
    // score в ShikimoriAnimeShort — строка, как её отдаёт REST.
    score: row.score !== null ? String(row.score) : '0.0',
    status: row.status ?? '',
    episodes: row.episodes,
    episodes_aired: row.episodes_aired,
    aired_on: row.aired_on,
    released_on: row.released_on,
    description: row.description,
    // Обложка с нашего диска, если она туда скачана (см. миграцию 0029).
    // Карточка пробует её первой; ссылки Shikimori остаются запасными.
    localPoster: row.poster_local ? localPosterUrl('anime', row.shikimori_id) : null,
  };
}

const SELECT_COLUMNS =
  'shikimori_id, name, russian, kind, status, episodes, episodes_aired, aired_on, released_on, score, poster_original, poster_preview, description, poster_local';

/** `{a,b}` — литерал массива Postgres, его ждут операторы `cs`/`ov`. */
function pgArray(values: (number | string)[]): string {
  return `{${values.join(',')}}`;
}

/**
 * Минимальный интерфейс билдера PostgREST — только то, что нужно applyTri.
 * Полный дженерик-тип supabase-js сюда не протащить: он параметризован
 * схемой, таблицей и формой select, и в хелпере превратился бы в десяток
 * параметров типа ради двух вызовов.
 */
interface TriFilterable<T> {
  in(column: string, values: readonly string[]): T;
  not(column: string, operator: string, value: string): T;
}

/** Трёхпозиционный набор → пара фильтров PostgREST по текстовой колонке. */
function applyTri<T extends TriFilterable<T>>(
  query: T,
  column: string,
  sel: TriState | undefined,
  fallbackInclude: string[] | null,
): T {
  let q = query;
  const include = sel?.include ?? [];
  const exclude = sel?.exclude ?? [];

  if (include.length > 0) q = q.in(column, include);
  else if (fallbackInclude) q = q.in(column, fallbackInclude);

  if (exclude.length > 0) q = q.not(column, 'in', `(${exclude.join(',')})`);
  return q;
}

/** Активная партия. null — индекса нет или он недоступен. */
async function getActiveBatchId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('anime_index_state')
      .select('active_batch')
      .eq('id', true)
      .maybeSingle();
    if (error || !data?.active_batch) return null;
    return data.active_batch as string;
  } catch {
    return null;
  }
}

export async function getAnimeCatalogFromIndex(
  params: AnimeCatalogParams,
): Promise<AnimeCatalogPage | null> {
  try {
    return await queryIndex(params);
  } catch (err) {
    console.error(
      '[animeIndexQuery] индекс недоступен, откат на Shikimori:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function queryIndex(params: AnimeCatalogParams): Promise<AnimeCatalogPage | null> {
  const batchId = await getActiveBatchId();
  if (!batchId) return null;

  const {
    genresInclude,
    genresExclude,
    sort,
    page,
    pageSize,
    excludeAnons,
    episodesFrom,
    episodesTo,
    yearFrom,
    yearTo,
    ratings,
    kinds,
    statuses,
  } = params;

  const supabase = createClient();

  // count: 'exact' нужен для hasMore: иначе пришлось бы запрашивать на одну
  // страницу больше и гадать. На индексированной таблице это дёшево.
  let query = supabase
    .from('anime_index')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .eq('batch_id', batchId);

  // Жанры: AND через `contains` (@>) и исключение через «не пересекается»
  // (not overlaps). Ровно та семантика, что была у медленного пути, только
  // одним условием вместо догрузки карточек.
  if (genresInclude.length > 0) query = query.contains('genre_ids', genresInclude);
  if (genresExclude.length > 0) query = query.not('genre_ids', 'ov', pgArray(genresExclude));

  // Тип: выбор пользователя перекрывает историческое умолчание каталога
  // (tv/movie/ona), иначе отметить «OVA» было бы невозможно.
  query = applyTri(query, 'kind', kinds, DEFAULT_KINDS);

  // Статус: явный выбор важнее галки «Показывать анонсы» — два контрола на
  // одну сущность, и молча смешивать их значило бы получить пустую выдачу
  // при «только анонсы» с выключенной галкой.
  const hasStatusFilter = (statuses?.include.length ?? 0) + (statuses?.exclude.length ?? 0) > 0;
  if (hasStatusFilter) query = applyTri(query, 'status', statuses, null);
  else if (excludeAnons) query = query.neq('status', 'anons');

  query = applyTri(query, 'rating', ratings, null);

  if (episodesFrom != null) query = query.gte('episodes_effective', episodesFrom);
  if (episodesTo != null) query = query.lte('episodes_effective', episodesTo);
  // Ноль — «сколько серий, неизвестно». При заданном диапазоне такие прячем:
  // показать их в ответ на «от 12 до 24» было бы враньём.
  if (episodesFrom != null || episodesTo != null) query = query.gt('episodes_effective', 0);

  if (yearFrom != null) query = query.gte('aired_year', yearFrom);
  if (yearTo != null) query = query.lte('aired_year', yearTo);

  switch (sort) {
    case 'ranked':
      query = query.order('score', { ascending: false, nullsFirst: false });
      break;
    case 'popularity':
      query = query.order('popularity_rank', { ascending: true, nullsFirst: false });
      break;
    case 'name':
      query = query.order('russian', { ascending: true, nullsFirst: false });
      break;
    default:
      query = query.order('aired_on', { ascending: false, nullsFirst: false });
  }
  // Вторичный ключ сортировки — иначе у тайтлов с одинаковой датой (а их
  // много: целый сезон выходит в один день) порядок между страницами
  // «плавает», и один и тот же тайтл может попасться дважды или пропасть.
  query = query.order('shikimori_id', { ascending: true });

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  if (error) {
    // Не бросаем: вызывающий откатится на Shikimori, каталог продолжит
    // работать, а причина останется в логах.
    console.error('[animeIndexQuery] запрос к индексу упал:', error.message);
    return null;
  }

  const rows = (data ?? []) as unknown as IndexRow[];
  return {
    items: rows.map(toShort),
    hasMore: count !== null ? from + rows.length < count : rows.length === pageSize,
  };
}

export interface IndexedGenre {
  id: number;
  russian: string;
  kind: string;
}

/** Таксономия из индекса: 22 жанра, 53 темы, 5 демографий вместо легаси-
 *  списка из 46 записей с мёртвой «Магией». null — индекса ещё нет. */
export async function getGenresFromIndex(): Promise<IndexedGenre[] | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('anime_genres')
      .select('id, russian, kind')
      .order('russian', { ascending: true });

    if (error || !data || data.length === 0) return null;
    return data as IndexedGenre[];
  } catch {
    return null;
  }
}

/**
 * Жанры одного тайтла — для кликабельных ссылок на его странице.
 *
 * Берём из индекса, а не из полной карточки Shikimori, ПОТОМУ ЧТО ID должны
 * совпадать с теми, которыми фильтрует каталог. У REST-карточки жанры
 * легаси-таксономии (там «Триллер» это 41), у индекса — актуальной (117), и
 * ссылка с легаси-id открыла бы каталог с фильтром, который ничего не
 * находит. Ровно та же рассинхронизация, из-за которой «Магия» не работала.
 *
 * null — индекса нет: страница тайтла тогда покажет жанры Shikimori обычным
 * текстом, без ссылок, и постер оттуда же. Лучше некликабельные подписи, чем
 * ссылки в никуда.
 */
export interface IndexedTitle {
  genres: { id: number; russian: string }[];
  /** Постер из индекса. У Shikimori часть карточек отдаёт битую ссылку —
   *  страница тайтла показывала заглушку «404», хотя в каталоге тот же тайтл
   *  был с обложкой: каталог давно читает индекс, а страница тайтла ходила в
   *  REST напрямую. */
  poster: string | null;
}

export async function getIndexedTitle(shikimoriId: number): Promise<IndexedTitle | null> {
  try {
    const batchId = await getActiveBatchId();
    if (!batchId) return null;

    const supabase = createClient();
    const { data, error } = await supabase
      .from('anime_index')
      .select('genre_ids, poster_original, poster_preview, poster_local')
      .eq('batch_id', batchId)
      .eq('shikimori_id', shikimoriId)
      .maybeSingle();

    if (error || !data) return null;

    const remote = (data.poster_original as string | null) ?? (data.poster_preview as string | null) ?? null;
    const poster = data.poster_local ? localPosterUrl('anime', shikimoriId) : remote;
    const ids = (data.genre_ids ?? []) as number[];
    if (ids.length === 0) return { genres: [], poster };

    const { data: names, error: namesError } = await supabase
      .from('anime_genres')
      .select('id, russian')
      .in('id', ids);
    if (namesError || !names) return { genres: [], poster };

    // Порядок как в самом тайтле, а не как вернула база: там он осмысленный
    // (основной жанр первым), у выборки по in() — произвольный.
    const byId = new Map(names.map((g) => [g.id as number, g.russian as string]));
    return {
      genres: ids
        .map((id) => ({ id, russian: byId.get(id) ?? '' }))
        .filter((g) => g.russian !== ''),
      poster,
    };
  } catch {
    return null;
  }
}

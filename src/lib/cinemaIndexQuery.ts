import { createClient } from '@/lib/supabase/server';
import { signImageUrl } from '@/lib/extract/proxy';
import type { TriState } from '@/lib/catalogFilters';
import type { CinemaShort } from '@/lib/videoseed-catalog';
import { cinemaKindLabel, type CinemaSort } from '@/lib/cinemaFilters';
import { localPosterUrl } from '@/lib/posterPath';

/**
 * Чтение каталога кино из локального индекса (миграция 0027,
 * lib/cinemaIndex.ts).
 *
 * Ради чего всё затевалось: Videoseed не умеет ни фильтровать, ни
 * сортировать — проверено, он молча игнорирует year=, genre_id= и sort_by=.
 * Прежний каталог поэтому тянул до 30 его страниц на клик, отбирал подстрокой
 * по строке жанров и сортировал пул из 120 записей. Здесь весь фильтр — один
 * SQL-запрос по всей базе.
 *
 * ВАЖНО: функции отсюда НИКОГДА не бросают. Исключение (нет таблиц, отвалился
 * Supabase) отменило бы откат — вызывающий поймал бы его своим catch и показал
 * ошибку вместо того, чтобы просто сходить в Videoseed по-старому.
 *
 * Читаем обычным клиентом с сессией пользователя, а не service_role: таблицы
 * индекса — публичные данные каталога с политикой чтения для всех. Пишут их
 * только кроны.
 */

interface IndexRow {
  kp_id: number;
  title: string | null;
  original_title: string | null;
  kind: string;
  is_serial: boolean;
  year: number | null;
  poster: string | null;
  rating: number | null;
  poster_local: boolean | null;
  description: string | null;
}

const SELECT_COLUMNS =
  'kp_id, title, original_title, kind, is_serial, year, poster, rating, poster_local, description';

/** `{a,b}` — литерал массива Postgres, его ждут операторы `cs`/`ov`. */
function pgArray(values: (number | string)[]): string {
  return `{${values.join(',')}}`;
}

/**
 * Строка индекса → карточка каталога. Постер в индексе лежит СЫРОЙ: наружу
 * он отдаётся через собственный прокси с подписью ограниченного срока
 * жизни (см. lib/extract/proxy.ts), и подписывать его при индексации значило
 * бы, что к утру все ссылки протухли.
 *
 * Подпись в try/catch: без PROXY_SIGNING_SECRET она бросает, и это роняло бы
 * ВЕСЬ каталог из-за постеров. Каталог без обложек — плохо, каталог с
 * «не удалось загрузить» вместо выдачи — хуже.
 */
function safeSign(url: string): string | null {
  try {
    return signImageUrl(url);
  } catch (err) {
    console.error(
      '[cinemaIndexQuery] постер не подписался:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function toShort(row: IndexRow): CinemaShort {
  // Прежний путь — через наш прокси, который на КАЖДЫЙ запрос заново качает
  // картинку с Videoseed и заново жмёт её через sharp. Локальная копия
  // (миграция 0029) убирает и поход к апстриму, и пережатие.
  const proxied = row.poster ? safeSign(row.poster) : null;
  const local = row.poster_local ? localPosterUrl('cinema', row.kp_id) : null;

  return {
    id: row.kp_id,
    title: row.title ?? row.original_title ?? '',
    poster: local ?? proxied,
    posterFallback: local ? proxied : null,
    year: row.year,
    // В CinemaShort.kind лежит подпись, а не код — так его выводит карточка.
    kind: cinemaKindLabel(row.kind),
    isSerial: row.is_serial,
    rating: row.rating !== null ? Number(row.rating) : null,
    description: row.description,
  };
}

interface TriFilterable<T> {
  in(column: string, values: readonly string[]): T;
  not(column: string, operator: string, value: string): T;
}

/** Трёхпозиционный набор → пара фильтров PostgREST по текстовой колонке. */
function applyTri<T extends TriFilterable<T>>(query: T, column: string, sel: TriState | undefined): T {
  let q = query;
  if (sel && sel.include.length > 0) q = q.in(column, sel.include);
  if (sel && sel.exclude.length > 0) q = q.not(column, 'in', `(${sel.exclude.join(',')})`);
  return q;
}

/** Активная партия. null — индекса нет или он недоступен. */
async function getActiveBatchId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('cinema_index_state')
      .select('active_batch')
      .eq('id', true)
      .maybeSingle();
    if (error || !data?.active_batch) return null;
    return data.active_batch as string;
  } catch {
    return null;
  }
}

export interface CinemaIndexParams {
  genresInclude: number[];
  genresExclude: number[];
  countriesInclude: number[];
  countriesExclude: number[];
  kinds: TriState;
  yearFrom: number | null;
  yearTo: number | null;
  sort: CinemaSort;
  page: number;
  pageSize: number;
}

export interface CinemaIndexPage {
  items: CinemaShort[];
  hasMore: boolean;
}

export async function getCinemaCatalogFromIndex(
  params: CinemaIndexParams,
): Promise<CinemaIndexPage | null> {
  try {
    return await queryIndex(params);
  } catch (err) {
    console.error(
      '[cinemaIndexQuery] индекс недоступен, откат на Videoseed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function queryIndex(params: CinemaIndexParams): Promise<CinemaIndexPage | null> {
  const batchId = await getActiveBatchId();
  if (!batchId) return null;

  const supabase = createClient();

  // count: 'exact' нужен для hasMore: иначе пришлось бы запрашивать на одну
  // страницу больше и гадать. На индексированной таблице это дёшево.
  let query = supabase
    .from('cinema_index')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .eq('batch_id', batchId);

  // Жанры и страны: AND через `contains` (@>) и исключение через
  // «не пересекается» (not overlaps) — оба покрыты GIN-индексами.
  if (params.genresInclude.length > 0) query = query.contains('genre_ids', params.genresInclude);
  if (params.genresExclude.length > 0) {
    query = query.not('genre_ids', 'ov', pgArray(params.genresExclude));
  }
  if (params.countriesInclude.length > 0) {
    query = query.contains('country_ids', params.countriesInclude);
  }
  if (params.countriesExclude.length > 0) {
    query = query.not('country_ids', 'ov', pgArray(params.countriesExclude));
  }

  query = applyTri(query, 'kind', params.kinds);

  if (params.yearFrom != null) query = query.gte('year', params.yearFrom);
  if (params.yearTo != null) query = query.lte('year', params.yearTo);

  switch (params.sort) {
    case 'last_episode':
      // У фильмов даты последней серии нет вовсе — они уходят в конец, и это
      // ровно то, чего ждёшь от такой сортировки.
      query = query.order('last_episode_at', { ascending: false, nullsFirst: false });
      break;
    case 'popularity':
      // Популярность TMDB — «сколько смотрят прямо сейчас», не производная
      // от оценки. Это разные сортировки, и нужны обе.
      query = query.order('popularity', { ascending: false, nullsFirst: false });
      break;
    case 'rating':
      // Сортируем по СГЛАЖЕННОМУ рейтингу (см. миграцию 0030): по сырому
      // первую страницу занимали безвестные фильмы с 10.00 от двух голосов.
      // На карточке при этом показывается настоящая оценка TMDB.
      query = query.order('rating_weighted', { ascending: false, nullsFirst: false });
      break;
    case 'name':
      // По ключу сортировки, а не по сырому названию (миграция 0032):
      // коллация Postgres ставит пунктуацию перед буквами, и первую страницу
      // занимали «- Ишь ты, Масленица!», «¡Ay, mi madre!», «... и в бедности».
      query = query.order('title_sort', { ascending: true, nullsFirst: false });
      break;
    default:
      // «Сначала новые» — по ГОДУ выпуска, а не по дате появления записи у
      // Videoseed. По дате добавления первыми шли фильмы 1986 и 1996 годов:
      // она про то, когда запись завели у апстрима, а не когда вышло кино.
      // Дата добавления осталась вторым ключом — внутри одного года свежая
      // запись впереди. Так же ведёт себя подборка «Новинки» на главной.
      query = query
        .order('year', { ascending: false, nullsFirst: false })
        .order('added_at', { ascending: false, nullsFirst: false });
  }
  // Вторичный ключ сортировки — иначе у записей с одинаковым значением
  // порядок между страницами «плавает», и один и тот же тайтл может
  // попасться дважды или пропасть.
  query = query.order('kp_id', { ascending: true });

  const from = (params.page - 1) * params.pageSize;
  const { data, error, count } = await query.range(from, from + params.pageSize - 1);

  if (error) {
    console.error('[cinemaIndexQuery] запрос к индексу упал:', error.message);
    return null;
  }

  const rows = (data ?? []) as unknown as IndexRow[];
  return {
    items: rows.map(toShort),
    hasMore: count !== null ? from + rows.length < count : rows.length === params.pageSize,
  };
}

export interface IndexedRef {
  id: number;
  name: string;
}

/**
 * Жанры для панели фильтров. Только настоящие: маркеры типа (Сериалы=20,
 * Мультфильмы=21, Мультсериалы=22, Короткометражки=7569) отсеиваются — они
 * дублируют переключатель «Тип», и в списке жанров от них одна путаница.
 */
export async function getCinemaGenresFromIndex(): Promise<IndexedRef[] | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('cinema_genres')
      .select('id, name')
      .eq('kind', 'genre')
      .order('name', { ascending: true });

    if (error || !data || data.length === 0) return null;
    return data as IndexedRef[];
  } catch {
    return null;
  }
}

/** Страны для панели фильтров. */
export async function getCinemaCountriesFromIndex(): Promise<IndexedRef[] | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('cinema_countries')
      .select('id, name')
      .order('name', { ascending: true });

    if (error || !data || data.length === 0) return null;
    return data as IndexedRef[];
  } catch {
    return null;
  }
}

/**
 * Похожие тайтлы по жанру — для страницы тайтла.
 *
 * До индекса это делалось через getCinemaCatalog, то есть до тридцати
 * страниц Videoseed по 50 записей НА КАЖДЫЙ просмотр карточки, с отбором
 * подстрокой по строке жанров. Теперь один запрос к своей базе.
 *
 * Жанр приходит названием (страница тайтла берёт его из ответа Videoseed),
 * поэтому сперва переводим название в id по справочнику.
 */
export async function getSimilarFromIndex(
  genreName: string,
  excludeId: number,
  limit = 12,
): Promise<CinemaShort[] | null> {
  try {
    const batchId = await getActiveBatchId();
    if (!batchId) return null;

    const supabase = createClient();
    const { data: genre } = await supabase
      .from('cinema_genres')
      .select('id')
      .eq('name', genreName)
      .maybeSingle();

    const genreId = (genre as { id: number } | null)?.id;
    if (!genreId) return null;

    const { data, error } = await supabase
      .from('cinema_index')
      .select(SELECT_COLUMNS)
      .eq('batch_id', batchId)
      .contains('genre_ids', [genreId])
      .neq('kp_id', excludeId)
      // По сглаженному рейтингу, а не по сырому: иначе в «похожем» оказались
      // бы фильмы с 10.00 от двух голосов (см. миграцию 0030).
      .order('rating_weighted', { ascending: false, nullsFirst: false })
      .order('kp_id', { ascending: true })
      .limit(limit);

    if (error || !data) return null;
    return (data as unknown as IndexRow[]).map(toShort);
  } catch (err) {
    console.error(
      '[cinemaIndexQuery] похожие не собрались, откат на Videoseed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

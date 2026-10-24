import { getCachedJson } from '@/lib/cache/apiCache';
import { singleFlight } from '@/lib/singleFlight';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fromIndexRow as bookFromRow } from '@/lib/books';
import { fromIndexRow as mangaFromRow } from '@/lib/manga';
import { fromIndexRow as ranobeFromRow } from '@/lib/ranobe';
import { triValues, type CatalogFilters, type FilterOptionDef } from '@/lib/catalogFilters';
import type { BookSummary } from '@/lib/bookShared';
import type { MangaSummary } from '@/lib/mangaShared';
import type { RanobeSummary } from '@/lib/ranobeShared';
import type { ReadingKind, ReadingSort } from '@/lib/readingFilters';

/**
 * Каталоги чтения с фильтрами (миграция 0063): один SQL к своему индексу на
 * страницу, как у кино. Фильтры приходят уже проверенными (parseFilters в
 * lib/catalogFilters.ts): названия — непустые строки разумной длины, числа —
 * в своих границах.
 *
 *   • «включить» жанры/теги — у тайтла есть ВСЕ выбранные (@>), как у
 *     MangaLib и у каталога кино;
 *   • «исключить» — нет НИ ОДНОГО из выбранных (не &&);
 *   • тип и статус — «один из выбранных» и «ни один из исключённых».
 *
 * Общее число не считается: count по фильтрам с массивами на сотнях тысяч
 * книг дорог, а пагинации достаточно знать, есть ли следующая страница —
 * для этого берём на одну строку больше.
 */

export interface ReadingCatalogPage<T> {
  items: T[];
  hasMore: boolean;
}

/** Значение для PostgREST-литерала: в кавычках, с экранированием — в
 *  названиях тегов бывают запятые, скобки и кавычки. */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** text[]-литерал для cs/ov. */
function pgArray(values: string[]): string {
  return `{${values.map(quoted).join(',')}}`;
}

/** Список для in.(…). */
function pgList(values: string[]): string {
  return `(${values.map(quoted).join(',')})`;
}

type Query = ReturnType<ReturnType<typeof createClient>['from']>['select'] extends (
  ...args: never[]
) => infer R
  ? R
  : never;

function applyTri(q: Query, column: string, include: string[], exclude: string[], array: boolean): Query {
  let next = q;
  if (array) {
    if (include.length > 0) next = next.filter(column, 'cs', pgArray(include));
    if (exclude.length > 0) next = next.not(column, 'ov', pgArray(exclude));
  } else {
    if (include.length > 0) next = next.filter(column, 'in', pgList(include));
    if (exclude.length > 0) next = next.not(column, 'in', pgList(exclude));
  }
  return next;
}

function applyRange(q: Query, column: string, from: number | null, to: number | null): Query {
  let next = q;
  if (from != null) next = next.gte(column, from);
  if (to != null) next = next.lte(column, to);
  return next;
}

/** Порядок выдачи; id — последним ключом, чтобы страницы не повторяли и не
 *  теряли записи. */
function applySort(q: Query, kind: ReadingKind, sort: ReadingSort): Query {
  const id = kind === 'books' ? 'book_id' : 'title_id';
  const popularity = kind === 'books' ? 'downloads' : 'views';
  const desc = { ascending: false, nullsFirst: false };
  const asc = { ascending: true, nullsFirst: false };
  switch (sort) {
    case 'rating':
      return q.order('rating', desc).order('votes', desc).order(id, asc);
    case 'new':
      return q.order('year', desc).order(popularity, desc).order(id, asc);
    case 'old':
      return q.order('year', asc).order(popularity, desc).order(id, asc);
    case 'chapters':
      return q.order('chapters_count', desc).order(id, asc);
    case 'added':
      return q.order(id, desc);
    case 'name':
      return q.order('title', asc).order(id, asc);
    default:
      return q.order(popularity, desc).order(id, asc);
  }
}

/** null — индекс недоступен (нет миграции, упал Supabase): страница честно
 *  скажет, что каталог не загрузился, а не «ничего не найдено». */
async function queryCatalog(
  kind: ReadingKind,
  filters: CatalogFilters,
  sort: ReadingSort,
  page: number,
  pageSize: number,
): Promise<{ rows: Record<string, unknown>[]; hasMore: boolean } | null> {
  const table = kind === 'books' ? 'book_index' : kind === 'manga' ? 'manga_index' : 'ranobe_index';
  const from = (Math.max(1, page) - 1) * pageSize;

  try {
    let q = createClient().from(table).select('*').eq('in_catalog', true) as Query;

    const genres = triValues(filters, 'genres');
    q = applyTri(q, 'genres', genres.include, genres.exclude, true);
    q = applyRange(q, 'year', filters.range.yearFrom ?? null, filters.range.yearTo ?? null);

    if (kind !== 'books') {
      const tags = triValues(filters, 'tags');
      const kinds = triValues(filters, 'kinds');
      const statuses = triValues(filters, 'statuses');
      q = applyTri(q, 'tags', tags.include, tags.exclude, true);
      q = applyTri(q, 'kind', kinds.include, kinds.exclude, false);
      q = applyTri(q, 'status', statuses.include, statuses.exclude, false);
      q = applyRange(q, 'rating', filters.range.ratingFrom ?? null, filters.range.ratingTo ?? null);
      q = applyRange(
        q,
        'chapters_count',
        filters.range.chaptersFrom ?? null,
        filters.range.chaptersTo ?? null,
      );
    }

    const { data, error } = await applySort(q, kind, sort).range(from, from + pageSize);
    if (error) {
      console.error(`[readingCatalog] ${kind}: ${error.message}`);
      return null;
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
  } catch (err) {
    console.error(`[readingCatalog] ${kind} упал:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getMangaCatalogFiltered(
  filters: CatalogFilters,
  sort: ReadingSort,
  page: number,
  pageSize: number,
): Promise<ReadingCatalogPage<MangaSummary> | null> {
  const res = await queryCatalog('manga', filters, sort, page, pageSize);
  return res && { items: res.rows.map(mangaFromRow), hasMore: res.hasMore };
}

export async function getRanobeCatalogFiltered(
  filters: CatalogFilters,
  sort: ReadingSort,
  page: number,
  pageSize: number,
): Promise<ReadingCatalogPage<RanobeSummary> | null> {
  const res = await queryCatalog('ranobe', filters, sort, page, pageSize);
  return res && { items: res.rows.map(ranobeFromRow), hasMore: res.hasMore };
}

export async function getBookCatalogFiltered(
  filters: CatalogFilters,
  sort: ReadingSort,
  page: number,
  pageSize: number,
): Promise<ReadingCatalogPage<BookSummary> | null> {
  const res = await queryCatalog('books', filters, sort, page, pageSize);
  return res && { items: res.rows.map(bookFromRow), hasMore: res.hasMore };
}

// ───────────────────────── Справочники для панели ─────────────────────────

export type ReadingFacetOptions = Record<string, FilterOptionDef[]>;

/** Тегов, которые встречаются реже, в панели не показываем: у Renovels их
 *  тысячи, большая часть — у одного-двух тайтлов, и список стал бы свалкой. */
const MIN_TAG_TITLES = 5;

/**
 * Пункты панели: какие жанры, теги, типы и статусы есть в каталоге. Считает
 * база (manga_catalog_facets / ranobe_catalog_facets, book_genre_counts),
 * код кэширует на 6 часов: каталог меняется раз в неделю.
 *
 * Названия с запятой отбрасываются: значения группы в адресе разделены
 * запятыми (lib/catalogFilters.ts), и такой пункт нельзя было бы выбрать.
 * Никогда не бросает — пустые списки, и панель просто не рисует группу.
 */
export async function getReadingFacets(kind: ReadingKind): Promise<ReadingFacetOptions> {
  const key = `reading:facets:${kind}`;
  try {
    return await singleFlight(key, 10 * 60 * 1000, () =>
      getCachedJson<ReadingFacetOptions>(key, 6 * 60 * 60, async (): Promise<ReadingFacetOptions> => {
        const toOptions = (rows: { name: string }[]): FilterOptionDef[] =>
          rows
            .filter((row) => row.name && !row.name.includes(','))
            .map((row) => ({ value: row.name, label: row.name }));

        if (kind === 'books') {
          const { data, error } = await createServiceClient().rpc('book_genre_counts', { lim: 1000 });
          if (error) throw new Error(error.message);
          const rows = ((data ?? []) as { genre: string }[]).map((row) => ({ name: row.genre }));
          return { genres: toOptions(rows) };
        }

        const fn = kind === 'manga' ? 'manga_catalog_facets' : 'ranobe_catalog_facets';
        const { data, error } = await createServiceClient().rpc(fn);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as { facet: string; name: string; count: number }[];
        const pick = (facet: string, min = 1) =>
          rows
            .filter((row) => row.facet === facet && Number(row.count) >= min)
            .sort((a, b) =>
              // Жанры и теги — по алфавиту (их ищут глазами по названию),
              // типы и статусы — по числу тайтлов (их единицы).
              facet === 'genre' || facet === 'tag'
                ? a.name.localeCompare(b.name, 'ru')
                : Number(b.count) - Number(a.count),
            );
        return {
          genres: toOptions(pick('genre')),
          tags: toOptions(pick('tag', MIN_TAG_TITLES)),
          kinds: toOptions(pick('kind')),
          statuses: toOptions(pick('status')),
        };
      }),
    );
  } catch (err) {
    console.error(`[readingCatalog] справочники ${kind}:`, err instanceof Error ? err.message : err);
    return {};
  }
}

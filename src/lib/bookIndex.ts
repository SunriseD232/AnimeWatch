import { createServiceClient } from '@/lib/supabase/service';
import { getCachedJson } from '@/lib/cache/apiCache';
import {
  fetchOpdsPage,
  listGenres,
  listSubgenres,
  type BookGenreLink,
} from '@/lib/books';
import type { BookSummary } from '@/lib/bookShared';

/**
 * Построение витрины каталога книг (см. миграцию 0054).
 *
 * Отличие от anime/podcast-индексов принципиальное: там индекс — сменяемая
 * партия (новые строки пишутся под новым batch_id, указатель переключается
 * после сборки). Здесь batch_id нет и строки не удаляются:
 *
 *   • book_index — это ещё и постоянный кэш метаданных. Карточка книги
 *     открывается ТОЛЬКО по записи в этой таблице: у Флибусты нет
 *     OPDS-эндпоинта «книга по id» (проверено живьём — `/opds/book/{id}`
 *     отдаёт корневой каталог). Удали партию — и все «продолжить чтение» и
 *     ссылки из поиска разом станут 404.
 *   • каталог Флибусты не пересобирается раз в сутки, а только пополняется.
 *     Поэтому витрина — это флаг `in_catalog` + `rank`, а не партия.
 *
 * Как обновляем витрину, не ломая её на середине:
 *   1. Собираем книги в память (сотни запросов, ничего не пишем).
 *   2. Проверяем, что выборка вменяемая — иначе индекс Флибусты лёг, и
 *      затирать витрину пустотой нельзя.
 *   3. Upsert всех найденных строк с `in_catalog = true` и новым `rank`.
 *   4. У всего, что не тронуто этим прогоном (`updated_at < начала прогона`),
 *      снимаем `rank` — книга уходит из витрины, но остаётся в каталоге.
 *
 * Что вообще есть в каталоге (`in_catalog`), с 0060 решает еженедельный
 * импорт SQL-дампа Флибусты (scripts/flibusta-import.sh): ~620 тыс. книг в
 * FB2/EPUB. Эта ночная пересборка — только витрина свежего и популярного
 * поверх него, с обложками и числом скачиваний, которых в дампе нет.
 *
 * Источники обхода: новинки (`/opds/new/{page}/new`, 20 книг на страницу) и
 * жанры (`/opds/genres` → поджанры → первая страница ленты). Глубина
 * намеренно ограничена: цель — представительная витрина; полный каталог —
 * дело импорта дампа.
 */

/** Сколько страниц новинок обходим. 40 × 20 = 800 свежих книг. */
const NEW_PAGES = 40;

/** Сколько верхних жанров берём. Всего их ~24; 16 покрывает основные. */
const GENRE_LIMIT = 16;

/** Сколько поджанров внутри жанра. */
const SUBGENRES_PER_GENRE = 4;

/** Страниц на поджанр. 4 × 16 × 20 ≈ 1280 книг в дополнение к новинкам. */
const PAGES_PER_SUBGENRE = 1;

/**
 * Пауза между запросами. У Флибусты нет документированного лимита, но
 * десятки запросов подряд с одного IP — это ровно то, за что банят. Прогон
 * ночной, спешить некуда.
 */
const REQUEST_INTERVAL_MS = 700;

/**
 * Справочник жанров и поджанров Флибусты помним неделю: он почти не
 * меняется, а `/opds/genres` — самая тяжёлая лента Флибусты. 24.10.2026 она
 * отвечала 504 через 50 секунд, обход остался без жанров, набрал 80 книг
 * новинок и витрина не обновилась. С запомненным справочником сбой ленты
 * жанров обход больше не останавливает.
 */
const GENRES_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Подряд упавших страниц новинок — дальше не идём: Флибуста лежит. */
const MAX_FAILED_IN_ROW = 5;

/** Предохранитель от разрастания памяти на 2ГБ VPS. */
const MAX_BOOKS = 8000;

/** Витрина меньше этого — почти наверняка обрыв, а не «каталог усох». */
const MIN_SANE_BOOKS = 100;

/** Усадка сильнее чем в два раза — тоже повод не трогать витрину. */
const MAX_SHRINK_RATIO = 0.5;

/** Размер пачки в upsert. Больше 500 PostgREST глотает неохотно. */
const CHUNK = 500;

/** Аннотация в карточке — не больше двух тысяч символов. */
const ANNOTATION_LIMIT = 2000;

/** Формат строки book_index. */
interface IndexRow {
  book_id: number;
  title: string;
  author: string | null;
  annotation: string | null;
  genres: string[];
  language: string | null;
  formats: string[];
  size_bytes: number | null;
  downloads: number | null;
  year: number | null;
  cover_url: string | null;
  source_url: string;
  rank: number;
  in_catalog: boolean;
  updated_at: string;
}

export interface BookReindexResult {
  books: number;
  requests: number;
  durationMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Справочник жанров/поджанров из кэша, а нет — с Флибусты. Пустой ответ
 *  (лента не пришла) не кэшируется: следующий прогон попробует снова. */
async function cachedGenres(
  key: string,
  load: () => Promise<BookGenreLink[]>,
): Promise<BookGenreLink[]> {
  try {
    return await getCachedJson<BookGenreLink[]>(`books:opds-genres:${key}`, GENRES_TTL_SECONDS, async () => {
      const links = await load();
      if (links.length === 0) throw new Error(`Флибуста не отдала ${key}`);
      return links;
    });
  } catch {
    return [];
  }
}

/**
 * Полная перестройка витрины. Возвращает статистику или бросает — причину
 * пишет вызывающий (крон-роут) в book_index_state.
 */
export async function rebuildBookIndex(): Promise<BookReindexResult> {
  const startedAt = new Date();
  const supabase = createServiceClient();

  await supabase
    .from('book_index_state')
    .update({ last_run_started_at: startedAt.toISOString(), last_error: null })
    .eq('id', true);

  // ── 1. Сбор в память ──
  // Ключ — id Флибусты: одна и та же книга встречается и в новинках, и в
  // нескольких жанрах. Первое вхождение выигрывает и получает меньший rank.
  const found = new Map<number, BookSummary>();
  let requests = 0;

  const remember = (items: BookSummary[]) => {
    for (const book of items) {
      if (found.size >= MAX_BOOKS) return;
      if (!found.has(book.id)) found.set(book.id, book);
    }
  };

  // Упавшую страницу пропускаем, а не обрываем весь проход (24.10.2026
  // Флибуста отдавала через раз): конец ленты — это пустая страница, а не
  // ошибка. Несколько ошибок подряд — источник лежит, дальше не ходим.
  let failedInRow = 0;
  for (let page = 0; page < NEW_PAGES && found.size < MAX_BOOKS; page++) {
    const res = await fetchOpdsPage(`/opds/new/${page}/new`);
    requests++;
    if (!res) {
      if (++failedInRow >= MAX_FAILED_IN_ROW) break;
      continue;
    }
    failedInRow = 0;
    if (res.items.length === 0) break;
    remember(res.items);
    await sleep(REQUEST_INTERVAL_MS);
  }

  const genres = (await cachedGenres('/opds/genres', listGenres)).slice(0, GENRE_LIMIT);
  requests++;

  for (const genre of genres) {
    if (found.size >= MAX_BOOKS) break;

    const subgenres = await cachedGenres(genre.path, () => listSubgenres(genre.path));
    requests++;
    await sleep(REQUEST_INTERVAL_MS);

    for (const sub of subgenres.slice(0, SUBGENRES_PER_GENRE)) {
      if (found.size >= MAX_BOOKS) break;

      for (let page = 1; page <= PAGES_PER_SUBGENRE; page++) {
        const res = await fetchOpdsPage(page > 1 ? `${sub.path}/${page - 1}` : sub.path);
        requests++;
        // Не пришла лента поджанра — к следующему поджанру, а не конец обхода.
        if (!res || res.items.length === 0) break;
        remember(res.items);
        await sleep(REQUEST_INTERVAL_MS);
      }
    }
  }

  const books = [...found.values()];
  const fresh = books.length;

  // ── 2. Проверка вменяемости ──
  const { data: state } = await supabase
    .from('book_index_state')
    .select('titles_count')
    .eq('id', true)
    .maybeSingle();

  const previous = state?.titles_count ?? 0;
  const shrunk = previous > 0 && fresh < previous * MAX_SHRINK_RATIO;

  if (fresh < MIN_SANE_BOOKS || shrunk) {
    throw new Error(
      `выборка подозрительно мала: ${fresh} (было ${previous}) — витрину не меняю`,
    );
  }

  // ── 3. Upsert собранного ──
  const nowIso = new Date().toISOString();
  const rows: IndexRow[] = books.map((book, i) => ({
    book_id: book.id,
    title: book.title,
    author: book.author || null,
    annotation: book.annotation ? book.annotation.slice(0, ANNOTATION_LIMIT) : null,
    genres: book.genres,
    language: book.language,
    formats: book.formats,
    size_bytes: book.sizeBytes,
    downloads: book.downloads,
    year: book.year,
    cover_url: book.coverUrl,
    source_url: book.sourceUrl,
    rank: i + 1,
    in_catalog: true,
    updated_at: nowIso,
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('book_index')
      .upsert(chunk, { onConflict: 'book_id' });
    if (error) {
      throw new Error(`upsert упал на строке ${i}: ${error.message}`);
    }
  }

  // ── 4. Снять место в витрине с тех, кто из неё выпал ──
  // Только rank. in_catalog решает еженедельный импорт дампа Флибусты
  // (scripts/flibusta-import.sh): раньше этот шаг снимал in_catalog со всего,
  // чего нет в сегодняшних лентах OPDS, и с дампом каждую ночь прятал бы
  // сотни тысяч книг. Строки, не тронутые этим прогоном, — те, у кого
  // updated_at старше начала (upsert проставил найденным nowIso).
  const { error: sweepError } = await supabase
    .from('book_index')
    .update({ rank: null })
    .not('rank', 'is', null)
    .lt('updated_at', startedAt.toISOString());

  if (sweepError) {
    // Витрина уже обновлена — это не повод валить прогон; порядок остался
    // с прошлой ночи, напишем об этом в состояние.
    console.error('[bookIndex] снять rank со старых книг не удалось:', sweepError.message);
  }

  const { error: stateError } = await supabase
    .from('book_index_state')
    .update({
      built_at: new Date().toISOString(),
      titles_count: fresh,
      last_run_finished_at: new Date().toISOString(),
      last_error: sweepError ? `rank не снят: ${sweepError.message}` : null,
    })
    .eq('id', true);

  if (stateError) {
    throw new Error(`не записал состояние индекса: ${stateError.message}`);
  }

  return {
    books: fresh,
    requests,
    durationMs: Date.now() - startedAt.getTime(),
  };
}

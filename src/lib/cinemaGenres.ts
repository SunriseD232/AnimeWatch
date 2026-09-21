import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Жанры каталога кино из официальной выгрузки IMDb (см. миграцию 0040).
 *
 * ЗАЧЕМ. Videoseed отдаёт жанры только фильмам. Сериалам, мультфильмам и
 * мультсериалам он кладёт один маркер типа («Сериалы»=20) и ничего больше —
 * поэтому у «Во все тяжкие» в индексе лежало {20}, а фильтр «Сериал» +
 * «Драма» не находил вообще ничего: такого сочетания в данных не было.
 *
 * ПОЧЕМУ ЦЕЛЫЙ ФАЙЛ, А НЕ ЗАПРОСЫ ПО ТАЙТЛАМ. title.basics.tsv.gz — это 227
 * МБ и 12,8 млн строк, но он отдаётся одним запросом без ключа и лимитов.
 * Замерено на проде: скачивание и полный проход занимают 20 секунд. Тот же
 * охват через TMDB — это 19 тысяч запросов через VLESS-туннель (двадцать
 * минут) и более грубый словарь: у TMDB для сериалов «НФ и Фэнтези» и
 * «Боевик и Приключения» идут одним пунктом, а триллера, ужасов, биографии
 * и спорта в сериальном словаре нет вовсе — эти фильтры так и остались бы
 * пустыми.
 *
 * Таблица cinema_imdb_genres перестройку каталога ПЕРЕЖИВАЕТ (как и
 * cinema_ratings), а в выдачу жанры попадают следующей перестройкой: она
 * сливает их с жанрами Videoseed. Так недельный джоб не может испортить
 * работающий каталог, что бы с ним ни случилось.
 */

const DATASET_URL = 'https://datasets.imdbws.com/title.basics.tsv.gz';

/**
 * Потолок на всё скачивание целиком, а не на первый байт: AbortSignal.timeout
 * прерывает и чтение тела. На проде проход занимает 20 секунд, так что
 * пятнадцать минут — это запас на случай, если IMDb отдаёт по капле, и
 * одновременно гарантия, что джоб не будет висеть до утра.
 */
const FETCH_TIMEOUT_MS = 15 * 60 * 1000;

/** PostgREST отдаёт максимум 1000 строк за запрос — см. те же циклы в
 *  cinemaRatings.ts, включая обязательный order() и выход только на пустой
 *  странице. */
const READ_PAGE = 1000;
const UPSERT_CHUNK = 500;

/**
 * Ниже этой доли найденных тайтлов результат не записываем.
 *
 * Страховка ровно от одного случая: IMDb меняет формат файла (переставляет
 * столбцы, переименовывает жанры) — проход отработает без ошибок, просто
 * ничего не совпадёт, и таблица молча обнулится. На проде совпадает 99,6%,
 * так что порог в половину не заденет ни одну нормальную выгрузку.
 */
const MIN_MATCH_RATIO = 0.5;

/**
 * Английские жанры IMDb → идентификаторы нашего справочника cinema_genres.
 *
 * Словарь IMDb шире нашего, поэтому часть жанров сознательно НЕ переводится:
 *
 * - Animation, Short — у нас это не жанры, а тип контента («Мультфильм»,
 *   «Короткометражка»), он живёт в отдельном переключателе и вычисляется по
 *   маркерам Videoseed (см. deriveKind). Занести их сюда значило бы
 *   показать в списке жанров то, что уже есть в «Типе».
 * - Music — это фильм ПРО музыку, а не мюзикл; «Мюзиклы» у нас отдельный
 *   жанр, и на него переводится только Musical. Смешивать их значит
 *   записать в мюзиклы каждый документальный фильм о группе.
 * - Adult, Film-Noir, Game-Show, News, Reality-TV, Talk-Show — нашему
 *   справочнику соответствия нет. Лучше не показать жанр, чем показать
 *   неверный: кнопка, ищущая не то, хуже отсутствующей.
 */
const IMDB_GENRE_MAP: Record<string, number> = {
  Action: 2, // Боевик
  Adventure: 13, // Приключения
  Biography: 1, // Биография
  Comedy: 10, // Комедия
  Crime: 11, // Криминал
  Documentary: 5, // Документальный
  Drama: 8, // Драма
  Family: 14, // Семейный
  Fantasy: 19, // Фэнтези
  History: 9, // История
  Horror: 17, // Ужасы
  Musical: 7570, // Мюзиклы
  Mystery: 6, // Детектив
  Romance: 12, // Мелодрама
  'Sci-Fi': 18, // Фантастика
  Sport: 15, // Спорт
  Thriller: 16, // Триллер
  War: 3, // Военный
  Western: 4, // Вестерн
};

/** Порядковые номера столбцов в title.basics.tsv — файл идёт с заголовком,
 *  но полагаться на него не будем: проверяем шапку явно, см. ниже. */
const COL_TCONST = 0;
const COL_GENRES = 8;
const EXPECTED_HEADER_START = 'tconst\ttitleType';

/** Перевод строки жанров IMDb («Action,Adventure,Sci-Fi») в наши id. */
export function mapImdbGenres(raw: string): number[] {
  if (!raw || raw === '\\N') return [];
  const out = new Set<number>();
  for (const name of raw.split(',')) {
    const id = IMDB_GENRE_MAP[name.trim()];
    if (id) out.add(id);
  }
  return [...out].sort((a, b) => a - b);
}

/** Все imdb_id активной партии — постранично, только один столбец. */
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
      // order() обязателен: без него страницы LIMIT/OFFSET перекрываются и
      // часть строк не попадает ни в одну (поймано вживую, см. 0027).
      .order('kp_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);

    if (error) throw new Error(`не прочитать imdb_id партии: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const id = (r as { imdb_id: string | null }).imdb_id;
      if (id) out.add(id);
    }
  }

  return out;
}

export interface GenresRunResult {
  /** Сколько тайтлов партии искали в выгрузке. */
  wanted: number;
  /** Сколько нашли. */
  matched: number;
  /** У скольких из найденных получился непустой набор наших жанров. */
  withGenres: number;
  /** Сколько строк прочитали из выгрузки — для журнала, это ~12,8 млн. */
  scanned: number;
  durationMs: number;
}

/**
 * Скачивает выгрузку IMDb и складывает жанры наших тайтлов в
 * cinema_imdb_genres. Бросает только на том, что делает работу бессмысленной
 * (нет партии, выгрузка недоступна, БД недоступна, формат файла изменился) —
 * вызывающий крон-роут пишет исход в cinema_index_state.
 */
export async function refreshCinemaGenres(): Promise<GenresRunResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();

  await supabase
    .from('cinema_index_state')
    .update({ genres_run_started_at: new Date().toISOString(), genres_error: null })
    .eq('id', true);

  const { data: state } = await supabase
    .from('cinema_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();

  const batchId = state?.active_batch as string | undefined;
  // Без построенного индекса обновлять нечего: список тайтлов берётся именно
  // из него — тот же порядок, что у рейтингов.
  if (!batchId) throw new Error('активной партии нет — сначала должна отработать перестройка');

  const wanted = await loadBatchImdbIds(supabase, batchId);
  if (wanted.size === 0) throw new Error('в активной партии нет ни одного imdb_id');

  const res = await fetch(DATASET_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`выгрузка IMDb не отдалась: HTTP ${res.status}`);

  // Разбираем ПОТОКОМ. Файл распакованным больше гигабайта, и .text() на нём
  // положил бы процесс целиком — на этой VPS всего 4 ГБ памяти на всё.
  const lines = createInterface({
    input: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const found = new Map<string, number[]>();
  let scanned = 0;
  let headerChecked = false;

  for await (const line of lines) {
    if (!headerChecked) {
      headerChecked = true;
      if (line.startsWith(EXPECTED_HEADER_START)) continue;
      // Столбцы разъехались — дальше читать нечего: мы бы разобрали мусор и
      // записали его как жанры.
      throw new Error(`шапка выгрузки IMDb не та, что ожидали: ${line.slice(0, 120)}`);
    }

    scanned++;
    // Полный split на 12,8 млн строк — это 100 млн лишних строковых объектов.
    // Сначала отрезаем только первый столбец и по нему отсеиваем чужое: наших
    // тайтлов в файле меньше процента.
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const tconst = line.slice(0, tab);
    if (!wanted.has(tconst)) continue;

    const cols = line.split('\t');
    if (cols.length <= COL_GENRES || cols[COL_TCONST] !== tconst) continue;
    found.set(tconst, mapImdbGenres(cols[COL_GENRES]));
  }

  const matched = found.size;
  if (matched < wanted.size * MIN_MATCH_RATIO) {
    throw new Error(
      `в выгрузке нашлось всего ${matched} из ${wanted.size} тайтлов — похоже на смену формата, ` +
        'ничего не записываю',
    );
  }

  const now = new Date().toISOString();
  const rows = [...found].map(([imdb_id, genre_ids]) => ({ imdb_id, genre_ids, updated_at: now }));

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from('cinema_imdb_genres')
      .upsert(chunk, { onConflict: 'imdb_id' });
    if (error) throw new Error(`не записались жанры: ${error.message}`);
  }

  const withGenres = rows.filter((r) => r.genre_ids.length > 0).length;

  await supabase
    .from('cinema_index_state')
    .update({
      genres_run_finished_at: new Date().toISOString(),
      genres_matched: matched,
      genres_error: null,
    })
    .eq('id', true);

  return {
    wanted: wanted.size,
    matched,
    withGenres,
    scanned,
    durationMs: Date.now() - startedAt,
  };
}

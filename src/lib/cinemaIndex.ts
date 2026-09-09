import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { loadStoredPosterIds } from '@/lib/posterCache';

/**
 * Построение локального индекса каталога кино (см. миграцию 0027).
 *
 * Источник — тот же Videoseed apiv2.php, что и раньше, но берём у него всё
 * разом и складываем к себе. Причина простая: фильтровать и сортировать он не
 * умеет ВООБЩЕ. Проверено вживую — `year=`, `genre_id=`, `sort_by=` он молча
 * игнорирует, `total` не меняется, порядок тот же. Поэтому каталог на каждый
 * клик тянул до 30 его страниц, отбирал подстрокой по строке жанров и
 * сортировал пул из 120 записей.
 *
 * Полный обход стоит 207 запросов: 82 455 фильмов и 20 969 сериалов по 500
 * записей на страницу (items=500 — практический потолок, на 1000 апстрим
 * отдаёт мусор из 12 записей).
 *
 * Перезакачка полная, но живая таблица не пустеет ни на секунду: строки
 * пишутся со своим batch_id, указатель переключается только после успеха и
 * проверок. Ровно как у аниме (lib/animeIndex.ts).
 */

const VIDEOSEED_API = 'https://api.videoseed.tv/apiv2.php';

/** Практический потолок апстрима: 500 отдаёт ровно 500, 1000 — 12 записей. */
const PAGE_SIZE = 500;

/** Пауза между запросами. Квота у Videoseed считается в запросах, а не в
 *  секундах, так что гнать можно и быстрее — но апстрим сам отвечает 1-3
 *  секунды, и вежливая пауза ничего не стоит на фоне этого. */
const REQUEST_INTERVAL_MS = 300;

/** Предохранитель от бесконечного цикла, если апстрим начнёт отдавать
 *  непустые страницы бесконечно. 82 тысячи фильмов — это 165 страниц. */
const MAX_PAGES_PER_TYPE = 400;

/**
 * Ниже этого остатка квоты за перестройку даже не беремся. У Videoseed
 * суточная квота порядка 5000 запросов, и она же нужна живому сайту:
 * страница тайтла, поиск и плеер ходят в апстрим напрямую. Спалить её
 * ночной перестройкой значит оставить сайт без плеера до утра.
 */
const MIN_QUOTA_TO_START = 800;

/** Партия меньше этого — точно обрыв, а не «каталог усох». */
const MIN_SANE_TITLES = 60_000;
const MAX_SHRINK_RATIO = 0.8;

/** Меньше этого в справочнике — словарь не сложился (апстрим сменил формат
 *  или отдал огрызок). Тогда НЕ перезаписываем прошлый: мёртвый справочник
 *  оставит фильтр без единой кнопки. */
const MIN_SANE_GENRES = 15;
const MIN_SANE_COUNTRIES = 20;

const MAX_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 60_000;

/** Сколько строк отправляем в Supabase за раз. */
const INSERT_CHUNK = 500;

/** Сколько сырых карточек КАЖДОГО типа откладываем на построение справочников. */
const DICT_SAMPLE_PER_TYPE = 4000;

/**
 * Жанры-маркеры типа. В списке жанров им не место — они дублируют
 * переключатель «Тип», — но из genre_ids не выкидываем: именно по ним и
 * вычисляется kind.
 */
const TYPE_MARKER_GENRES = {
  serial: 20,
  cartoon: 21,
  cartoonSerial: 22,
  short: 7569,
} as const;

const TYPE_MARKER_IDS: number[] = Object.values(TYPE_MARKER_GENRES);

interface VsRawItem {
  id?: string;
  id_kp?: string | null;
  id_imdb?: string | null;
  id_tmdb?: string | null;
  name?: string;
  original_name?: string;
  year?: string;
  poster?: string;
  description?: string;
  genre?: string;
  /** У фильмов поле называется genre_ids, у сериалов — genres_id. Это не
   *  опечатка здесь, это расхождение в самом API (проверено на выборке). */
  genre_ids?: string;
  genres_id?: string;
  country?: string;
  country_ids?: string;
  type?: string;
  time?: string;
  translation?: string;
  date?: string;
  last_content_date?: string;
}

interface VsResponse {
  status?: string;
  data?: VsRawItem[];
  total?: string;
  requests_available?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function token(): string {
  const t = process.env.VIDEOSEED_API_TOKEN;
  if (!t) throw new Error('нет VIDEOSEED_API_TOKEN');
  return t;
}

async function vsFetch(params: Record<string, string>): Promise<VsResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const search = new URLSearchParams({ token: token(), ...params });
      const res = await fetch(`${VIDEOSEED_API}?${search.toString()}`, {
        // Индекс строится кроном, кэш Next тут только мешал бы: он рассчитан
        // на пользовательские запросы и держал бы 150 МБ ответов в памяти.
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as VsResponse;
      if (json.status && json.status !== 'success') {
        throw new Error(`апстрим ответил status=${json.status}`);
      }
      return json;
    } catch (err) {
      lastError = err;
      // Пауза растёт с попытками: сетевой сбой лечится сразу, упор в лимит
      // апстрима — только ожиданием.
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 3000);
    }
  }

  throw new Error(`Videoseed не ответил за ${MAX_ATTEMPTS} попытки: ${String(lastError)}`);
}

/**
 * Словарь id → название из параллельных полей вида `2,8,13` и
 * `Боевик, Драма, Приключения`.
 *
 * ПО ПОЗИЦИИ СОПОСТАВЛЯТЬ НЕЛЬЗЯ, хотя соблазн велик и на большинстве
 * записей это сработает: названия апстрим отдаёт по алфавиту, id — по
 * возрастанию, и порядки расходятся (Вестерн=4 идёт раньше Военный=3,
 * Мультсериалы=22 раньше Сериалы=20). Позиционное сопоставление на такой
 * записи выдаёт зеркально перепутанную пару, и «Военный» в фильтре начинает
 * искать вестерны.
 *
 * Поэтому берём пересечение: для каждого id — множество названий, общих для
 * ВСЕХ записей с этим id. На десятках тысяч записей оно схлопывается до
 * одного элемента. Что не схлопнулось — дорешиваем вычитанием уже
 * однозначных (классическая «судоку»-редукция) и, если и это не помогло,
 * просто выбрасываем: лучше нет кнопки, чем кнопка, ищущая не то.
 */
function inferDictionary(
  items: VsRawItem[],
  idFields: (keyof VsRawItem)[],
  nameField: keyof VsRawItem,
): Map<number, string> {
  const candidates = new Map<string, Set<string>>();

  for (const item of items) {
    const idField = idFields.find((f) => item[f]);
    if (!idField) continue;

    const ids = new Set(
      String(item[idField] ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    );
    const names = new Set(
      String(item[nameField] ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    );
    // Размеры разошлись — в самих данных запятая внутри названия или
    // рассинхрон полей. Такая запись для словаря бесполезна, но для индекса
    // годится; просто пропускаем её здесь.
    if (ids.size === 0 || ids.size !== names.size) continue;

    for (const id of ids) {
      const prev = candidates.get(id);
      if (!prev) candidates.set(id, new Set(names));
      else for (const n of prev) if (!names.has(n)) prev.delete(n);
    }
  }

  // Редукция: однозначные снимаем и вычитаем из остальных, пока сходится.
  for (let pass = 0; pass < 10; pass++) {
    const solved = new Set<string>();
    for (const set of candidates.values()) if (set.size === 1) solved.add([...set][0]);

    let changed = false;
    for (const set of candidates.values()) {
      if (set.size <= 1) continue;
      for (const name of solved) {
        if (set.delete(name)) changed = true;
      }
      // Вычли всё — откатывать нечего, но и писать пустоту нельзя: такой id
      // просто не попадёт в словарь (см. фильтр ниже).
      if (set.size === 0) changed = true;
    }
    if (!changed) break;
  }

  const out = new Map<number, string>();
  for (const [id, set] of candidates) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (set.size !== 1) continue;
    out.set(n, [...set][0]);
  }
  return out;
}

function parseIds(raw: string | null | undefined): number[] {
  return String(raw ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** «2024» → 2024; «0», мусор и абсурдные значения → null. */
function parseYear(raw: string | null | undefined): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const year = Math.trunc(n);
  const max = new Date().getFullYear() + 5;
  return year >= 1880 && year <= max ? year : null;
}

/** «01:38:37» → 98 минут. Мусор и нули → null. */
function parseDurationMin(raw: string | null | undefined): number | null {
  const parts = String(raw ?? '').split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = h * 60 + m;
  // Больше суток — это не длительность, а суммарное время сериала или мусор.
  return total > 0 && total <= 1440 ? total : null;
}

/**
 * «2024-06-26 10:23:00» → ISO. Часового пояса апстрим не сообщает; считаем
 * UTC. Для сортировки «сначала новые» и «по дате последней серии» сдвиг в
 * пару часов роли не играет, а разнобой в трактовке — играл бы.
 */
function parseStamp(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 2) return null;
  return d.toISOString();
}

/**
 * Тип контента для фильтра. У Videoseed своего поля с такой детализацией нет
 * — только movie/serial, — а различать мультфильмы и короткометражки нужно,
 * поэтому достраиваем по жанрам-маркерам.
 */
function deriveKind(item: VsRawItem, genreIds: number[]): string {
  const has = (id: number) => genreIds.includes(id);
  if (has(TYPE_MARKER_GENRES.short)) return 'short';

  const isSerial = item.type === 'serial' || has(TYPE_MARKER_GENRES.serial);
  if (isSerial) {
    // Мультсериалы у апстрима помечены 22, но встречаются и с 21 —
    // засчитываем оба, иначе часть мультсериалов уедет в обычные сериалы.
    return has(TYPE_MARKER_GENRES.cartoonSerial) || has(TYPE_MARKER_GENRES.cartoon)
      ? 'cartoon_serial'
      : 'serial';
  }
  return has(TYPE_MARKER_GENRES.cartoon) ? 'cartoon' : 'movie';
}

interface IndexRow {
  batch_id: string;
  kp_id: number;
  vs_id: number | null;
  title: string | null;
  original_title: string | null;
  kind: string;
  is_serial: boolean;
  year: number | null;
  poster: string | null;
  description: string | null;
  duration_min: number | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  added_at: string | null;
  last_episode_at: string | null;
  translation: string | null;
  genre_ids: number[];
  country_ids: number[];
  rating: number | null;
  rating_weighted: number | null;
  popularity: number | null;
  poster_local: boolean;
}

function toRow(
  item: VsRawItem,
  batchId: string,
  ratings: Map<string, { rating: number | null; weighted: number | null; popularity: number | null }>,
  storedPosters: Set<number>,
): IndexRow | null {
  const kpId = Number(item.id_kp);
  // Без kinopoisk_id тайтл бесполезен: по нему открывается плеер и пишется
  // прогресс. Такие записи апстрим отдаёт, и раньше их отсеивал каталог.
  if (!Number.isFinite(kpId) || kpId <= 0) return null;

  const title = (item.name ?? '').trim() || (item.original_name ?? '').trim();
  if (!title) return null;

  const genreIds = parseIds(item.genre_ids ?? item.genres_id);
  const kind = deriveKind(item, genreIds);
  const imdbId = (item.id_imdb ?? '').trim() || null;
  const tmdbId = Number(item.id_tmdb);

  return {
    batch_id: batchId,
    kp_id: kpId,
    vs_id: Number.isFinite(Number(item.id)) ? Number(item.id) : null,
    title,
    original_title: (item.original_name ?? '').trim() || null,
    kind,
    is_serial: kind === 'serial' || kind === 'cartoon_serial',
    year: parseYear(item.year),
    // Постер кладём СЫРЫМ. Наружу он отдаётся через signImageUrl с
    // ограниченным сроком жизни (см. lib/extract/proxy.ts), и подписывать
    // его на этапе индексации значило бы, что к утру все ссылки протухли.
    poster: (item.poster ?? '').trim() || null,
    description: (item.description ?? '').trim() || null,
    duration_min: item.type === 'serial' ? null : parseDurationMin(item.time),
    imdb_id: imdbId,
    tmdb_id: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
    added_at: parseStamp(item.date),
    last_episode_at: parseStamp(item.last_content_date),
    translation: (item.translation ?? '').trim() || null,
    genre_ids: genreIds,
    country_ids: parseIds(item.country_ids),
    rating: imdbId ? (ratings.get(imdbId)?.rating ?? null) : null,
    rating_weighted: imdbId ? (ratings.get(imdbId)?.weighted ?? null) : null,
    popularity: imdbId ? (ratings.get(imdbId)?.popularity ?? null) : null,
    // Флаг наследуется от долгоживущего кэша обложек (миграция 0029): файлы
    // перестройку переживают, и терять их на сутки незачем.
    poster_local: storedPosters.has(kpId),
  };
}

/** Рейтинг и популярность из долгоживущей таблицы — проставляем прямо при
 *  сборке партии. Читаем страницами: PostgREST отдаёт максимум 1000 за раз. */
async function loadRatings(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<Map<string, { rating: number | null; weighted: number | null; popularity: number | null }>> {
  const out = new Map<string, { rating: number | null; weighted: number | null; popularity: number | null }>();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('cinema_ratings')
      .select('imdb_id, rating, rating_weighted, popularity')
      // Строки, где нет ни того, ни другого, в партии бесполезны.
      .or('rating.not.is.null,popularity.not.is.null')
      // order() обязателен: без него Postgres не обещает порядок между
      // LIMIT/OFFSET-запросами, страницы перекрываются и часть строк не
      // попадает ни в одну. Поймано вживую на списке imdb_id.
      .order('imdb_id', { ascending: true })
      .range(from, from + PAGE - 1);

    // Рейтинги — не повод ронять перестройку: без них каталог работает,
    // просто сортировка «По рейтингу» отправит всё в конец.
    if (error) {
      console.error('[cinemaIndex] рейтинги прочитать не удалось:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const r of data) {
      const row = r as {
        imdb_id: string;
        rating: number | null;
        rating_weighted: number | null;
        popularity: number | null;
      };
      const rating = Number(row.rating);
      const weighted = Number(row.rating_weighted);
      const popularity = Number(row.popularity);
      out.set(row.imdb_id, {
        rating: Number.isFinite(rating) ? rating : null,
        weighted: Number.isFinite(weighted) ? weighted : null,
        popularity: Number.isFinite(popularity) ? popularity : null,
      });
    }
    // Выходим только на пустой странице: PostgREST на части страниц отдаёт
    // меньше запрошенного, и «пришло меньше — значит конец» обрывало чтение
    // на середине (проверено вживую на списке imdb_id).
  }

  return out;
}

export interface CinemaReindexResult {
  titles: number;
  movies: number;
  serials: number;
  genres: number;
  countries: number;
  rated: number;
  pages: number;
  quotaLeft: number | null;
  durationMs: number;
  batchId: string;
}

/**
 * Полная перестройка индекса. Возвращает статистику или бросает — вызывающий
 * (крон-роут) пишет исход в cinema_index_state.
 */
export async function rebuildCinemaIndex(): Promise<CinemaReindexResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const batchId = randomUUID();

  await supabase
    .from('cinema_index_state')
    .update({ last_run_started_at: new Date().toISOString(), last_error: null })
    .eq('id', true);

  // ── Проверка квоты ДО всего остального ──
  // Один запрос, чтобы узнать остаток и заодно общее число записей. Если
  // квоты в обрез — уходим, не начав: недостроенная партия не страшна, а вот
  // сайт без квоты до утра остаётся без плеера и поиска.
  const probe = await vsFetch({ list: 'movie', items: '1', from: '1' });
  const quotaLeft = Number(probe.requests_available);
  if (Number.isFinite(quotaLeft) && quotaLeft < MIN_QUOTA_TO_START) {
    throw new Error(
      `остаток квоты Videoseed ${quotaLeft} меньше порога ${MIN_QUOTA_TO_START} — перестройка отменена`,
    );
  }

  // ── Уборка за прошлыми неудачами ──
  // Прогон, упавший ПОСЛЕ начала вставки, оставляет свои строки навсегда:
  // discardBatch срабатывает только при провале проверок или после успешного
  // переключения. Чистим всё, что не является активной партией.
  const { data: before } = await supabase
    .from('cinema_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();

  if (before?.active_batch) {
    const { error } = await supabase
      .from('cinema_index')
      .delete()
      .neq('batch_id', before.active_batch);
    if (error) console.error('[cinemaIndex] уборка старых партий не удалась:', error.message);
  } else {
    const { error } = await supabase.from('cinema_index').delete().not('batch_id', 'is', null);
    if (error) console.error('[cinemaIndex] уборка перед первой сборкой не удалась:', error.message);
  }

  const ratings = await loadRatings(supabase);
  const storedPosters = await loadStoredPosterIds(supabase, 'cinema');

  // ── Обход ──
  const seen = new Set<number>();
  const dictSample: VsRawItem[] = [];
  let pages = 0;
  // Выборка для словаря набирается ПО КАЖДОМУ ТИПУ отдельно. Общий счётчик
  // на оба типа набивался бы одними фильмами (их обход идёт первым), и
  // маркеры «Сериалы»/«Мультсериалы», которых у фильмов нет в принципе, в
  // словарь не попадали вовсе — проверено на первом же боевом прогоне.
  // Страны у сериалов тоже свои (Корея, Турция, Таиланд там куда заметнее).
  let sampledForType = 0;
  let movies = 0;
  let serials = 0;
  let rated = 0;
  let lastQuota: number | null = Number.isFinite(quotaLeft) ? quotaLeft : null;

  for (const type of ['movie', 'serial'] as const) {
    sampledForType = 0;
    for (let page = 1; page <= MAX_PAGES_PER_TYPE; page++) {
      const res = await vsFetch({
        list: type,
        items: String(PAGE_SIZE),
        from: String(page),
      });
      pages++;

      const avail = Number(res.requests_available);
      if (Number.isFinite(avail)) lastQuota = avail;

      const batch = res.data ?? [];
      if (batch.length === 0) break;

      // Словарь строим на выборке: чем записей больше, тем надёжнее
      // схлопывается пересечение, но держать в памяти 100 тысяч сырых
      // карточек ради этого не нужно — на первых страницах каждого типа уже
      // встречаются все жанры и почти все страны.
      if (sampledForType < DICT_SAMPLE_PER_TYPE) {
        dictSample.push(...batch);
        sampledForType += batch.length;
      }

      const rows: IndexRow[] = [];
      for (const item of batch) {
        const row = toRow(item, batchId, ratings, storedPosters);
        // Дубли: один и тот же kinopoisk_id встречается и у нескольких
        // записей апстрима, и между страницами, если он что-то переставил
        // прямо во время обхода. Первичный ключ бы на них упал.
        if (!row || seen.has(row.kp_id)) continue;
        seen.add(row.kp_id);
        rows.push(row);
        if (row.rating !== null) rated++;
        if (row.is_serial) serials++;
        else movies++;
      }

      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK);
        const { error } = await supabase.from('cinema_index').insert(chunk);
        if (error) throw new Error(`вставка ${type} стр. ${page} упала: ${error.message}`);
      }

      if (batch.length < PAGE_SIZE) break; // апстрим исчерпан
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  const titles = seen.size;

  // ── Справочники ──
  // После обхода, а не до: словарь выводится из тех же данных.
  const genreDict = inferDictionary(dictSample, ['genre_ids', 'genres_id'], 'genre');
  const countryDict = inferDictionary(dictSample, ['country_ids'], 'country');

  if (genreDict.size >= MIN_SANE_GENRES) {
    await upsertDictionary(
      supabase,
      'cinema_genres',
      [...genreDict].map(([id, name]) => ({
        id,
        name,
        kind: TYPE_MARKER_IDS.includes(id) ? 'type' : 'genre',
        updated_at: new Date().toISOString(),
      })),
    );
  } else {
    console.error(
      `[cinemaIndex] справочник жанров сложился из ${genreDict.size} пунктов — оставляю прошлый`,
    );
  }

  if (countryDict.size >= MIN_SANE_COUNTRIES) {
    await upsertDictionary(
      supabase,
      'cinema_countries',
      [...countryDict].map(([id, name]) => ({ id, name, updated_at: new Date().toISOString() })),
    );
  } else {
    console.error(
      `[cinemaIndex] справочник стран сложился из ${countryDict.size} пунктов — оставляю прошлый`,
    );
  }

  // ── Проверки на вменяемость до переключения ──
  const { data: state } = await supabase
    .from('cinema_index_state')
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
  const previousBatch = state?.active_batch ?? null;
  const { error: swapError } = await supabase
    .from('cinema_index_state')
    .update({
      active_batch: batchId,
      built_at: new Date().toISOString(),
      titles_count: titles,
      last_run_finished_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', true);
  if (swapError) throw new Error(`не переключился указатель партии: ${swapError.message}`);

  // Старая партия больше не нужна. Не удалилась — не страшно, следующий
  // запуск подчистит: читатели фильтруют по active_batch.
  if (previousBatch) await discardBatch(supabase, previousBatch);

  return {
    titles,
    movies,
    serials,
    genres: genreDict.size,
    countries: countryDict.size,
    rated,
    pages,
    quotaLeft: lastQuota,
    durationMs: Date.now() - startedAt,
    batchId,
  };
}

async function upsertDictionary(
  supabase: ReturnType<typeof createServiceClient>,
  table: 'cinema_genres' | 'cinema_countries',
  rows: Record<string, unknown>[],
): Promise<void> {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`не записался справочник ${table}: ${error.message}`);

  // Пункты, исчезнувшие из выдачи апстрима, убираем — иначе в панели
  // фильтров навсегда останется кнопка, которая ничего не находит.
  const liveIds = rows.map((r) => r.id as number);
  await supabase.from(table).delete().not('id', 'in', `(${liveIds.join(',')})`);
}

async function discardBatch(
  supabase: ReturnType<typeof createServiceClient>,
  batchId: string,
): Promise<void> {
  const { error } = await supabase.from('cinema_index').delete().eq('batch_id', batchId);
  if (error) console.error('[cinemaIndex] не удалось удалить партию', batchId, error.message);
}

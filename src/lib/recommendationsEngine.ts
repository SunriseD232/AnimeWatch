import { createServiceClient } from '@/lib/supabase/service';
import { mapWithConcurrency } from '@/lib/concurrency';
import { cacheBackdrops, type BackdropCandidate } from '@/lib/backdropCache';
import type { BackdropKind } from '@/lib/backdropPath';
import { vlessDispatcher } from '@/lib/net/vlessProxy';
import {
  checkOpenRouterBalance,
  fetchOpenRouterBalance,
  notifyAdminsAboutOpenRouter,
} from '@/lib/openrouterBalance';
import type { CatalogType } from '@/lib/types';

/** Рекомендации строятся только по каталогам аниме и кино: у подкастов нет
 *  ни anime_index/cinema_index, ни жанровых id в тех же таблицах. CatalogType
 *  (см. lib/types.ts) держит Record-таблицы ниже исчерпывающими и не даёт
 *  случайно передать сюда 'podcast'. */

/** Внутренний ключ для гостевого «пользователя» в rankedByUser (см. ниже) —
 *  не пишется никуда в базу (hero теперь выбирается на чтении, см.
 *  getHeroPick в lib/recommendations.ts), нужен только чтобы гостевой
 *  популярный пул тоже попал в общий список на докачку обложек. */
const GUEST_TRACKING_KEY = 'guest';

/**
 * Крон-логика блока «Рекомендуем посмотреть» + hero главной (см. план
 * редизайна). Вызывается из api/cron/refresh-recommendations раз в сутки.
 *
 * Дороже здесь ТОЛЬКО обращение к OpenRouter (одно на пользователя на
 * раздел) и точечный запрос к Kitsu за coverImage — оба ограничены по
 * размеру: кандидатов на пользователя не больше CANDIDATE_LIMIT, обложек
 * скачивается только для тех тайтлов, что реально стали чьим-то hero
 * сегодня, а не для всего каталога.
 */

const OPENROUTER_MODEL = 'z-ai/glm-5.3-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Через VLESS-туннель (см. импорт vlessDispatcher ниже) один запрос к модели
// заметно медленнее прямого — 30с оказалось мало, часть запросов обрывалась
// по таймауту раньше, чем модель успевала ответить.
const OPENROUTER_TIMEOUT_MS = 60_000;
const OPENROUTER_CONCURRENCY = 3;

// 80, а не 50: пул теперь делится на квоты по странам, и при 50 на каждую
// страну оставалось слишком мало, чтобы модели было из чего выбирать.
const CANDIDATE_LIMIT = 80;
const RECOMMENDATION_LIMIT = 12;
const WATCHED_ID_CAP = 300;
/** Страна получает свою квоту в пуле, если на неё приходится хотя бы такая
 *  доля истории; больше COUNTRY_MAX стран не делим — квоты станут крошечными. */
const COUNTRY_MIN_SHARE = 0.15;
const COUNTRY_MAX = 3;
/** Типы («Сериалы», «Мультфильмы»…) — не вкус, а формат: тип, который занимает
 *  не меньше TYPE_REQUIRE_SHARE истории, обязателен для кандидатов, тип реже
 *  TYPE_EXCLUDE_SHARE — исключён. Иначе, выкинув типы из жанров, в пул
 *  человеку, который смотрит почти одни сериалы, полезли фильмы и детские
 *  мультики («Маша и медведь», «Лунтик» — проверено на живом пользователе). */
const TYPE_REQUIRE_SHARE = 0.7;
const TYPE_EXCLUDE_SHARE = 0.15;

const KITSU_URL = 'https://kitsu.io/api/edge/mappings';
const KITSU_IDS_PER_REQUEST = 20;
const KITSU_INTERVAL_MS = 700;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w1280';

type SupabaseService = ReturnType<typeof createServiceClient>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TABLE: Record<CatalogType, string> = { anime: 'anime_index', cinema: 'cinema_index' };
const STATE_TABLE: Record<CatalogType, string> = {
  anime: 'anime_index_state',
  cinema: 'cinema_index_state',
};
const ID_COLUMN: Record<CatalogType, string> = { anime: 'shikimori_id', cinema: 'kp_id' };
const TITLE_COLUMN: Record<CatalogType, string> = { anime: 'russian', cinema: 'title' };

async function getActiveBatchId(
  supabase: SupabaseService,
  contentType: CatalogType,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(STATE_TABLE[contentType])
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();
  if (error) {
    console.error(`[recommendationsEngine] активная партия ${contentType} не прочиталась:`, error.message);
    return null;
  }
  return (data?.active_batch as string | undefined) ?? null;
}

/** Все пользователи с хоть какой-то историей (watch_progress ∪ user_list). */
async function getActiveUserIds(supabase: SupabaseService): Promise<string[]> {
  const ids = new Set<string>();
  const PAGE = 1000;

  for (const table of ['watch_progress', 'user_list']) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select('user_id')
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data) ids.add((r as { user_id: string }).user_id);
      if (data.length < PAGE) break;
    }
  }

  return [...ids];
}

/** Справочники раздела: имена жанров и стран для промпта и id жанров-«типов».
 *  В cinema_genres рядом с жанрами лежат типы (kind='type': «Сериалы»,
 *  «Мультфильмы»…). В профиль вкуса их пускать нельзя: «Сериалы» у любого,
 *  кто смотрит сериалы, оказывается жанром №1, а overlaps по нему пропускает
 *  в пул вообще любой популярный сериал — так подборка и выродилась в
 *  американские процедуралы по общей популярности. */
interface Dictionaries {
  genreNames: Map<number, string>;
  typeGenreIds: Set<number>;
  countryNames: Map<number, string>;
}

const GENRE_TABLE: Record<CatalogType, string> = { anime: 'anime_genres', cinema: 'cinema_genres' };

async function getDictionaries(
  supabase: SupabaseService,
  contentType: CatalogType,
): Promise<Dictionaries> {
  const [{ data: genres, error: genresError }, countries] = await Promise.all([
    supabase.from(GENRE_TABLE[contentType]).select('*'),
    contentType === 'cinema'
      ? supabase.from('cinema_countries').select('id, name')
      : Promise.resolve({ data: [] as { id: number; name: string }[], error: null }),
  ]);
  if (genresError) {
    console.error(`[recommendationsEngine] справочник жанров ${contentType} не прочитался:`, genresError.message);
  }

  const genreNames = new Map<number, string>();
  const typeGenreIds = new Set<number>();
  for (const g of (genres ?? []) as { id: number; name: string; russian?: string | null; kind?: string }[]) {
    genreNames.set(g.id, g.russian || g.name);
    if (g.kind === 'type') typeGenreIds.add(g.id);
  }

  const countryNames = new Map<number, string>();
  for (const c of (countries.data ?? []) as { id: number; name: string }[]) countryNames.set(c.id, c.name);

  return { genreNames, typeGenreIds, countryNames };
}

/** Строка истории для промпта: модель должна видеть не только «что», но и
 *  «как»: досмотренное и брошенное после первой серии — противоположные
 *  сигналы, а раньше оба приходили ей одинаковым названием в общем списке. */
interface HistoryEntry {
  title: string;
  status: string;
  at: string;
}

interface CountryQuota {
  id: number;
  share: number;
}

interface UserHistory {
  /** Что человек уже так или иначе трогал — по этим тайтлам считаем его
   *  вкус (жанры, страны). */
  watchedIds: number[];
  /**
   * Что НЕЛЬЗЯ предлагать: посмотрел, смотрит, пересматривает, бросил или
   * начал (есть watch_progress). ЗАПЛАНИРОВАННОЕ сюда не входит — его
   * рекомендовать можно и нужно, это напоминание «ты хотел, вот оно».
   * Раньше исключались все записи списка без разбора статуса.
   */
  excludedIds: number[];
  genreIds: number[];
  /** Доли стран в истории (только кино: у anime_index стран нет). По ним
   *  пул кандидатов делится на квоты, иначе общая популярность вытесняет
   *  всё неамериканское — у человека с половиной русских сериалов в истории
   *  в пуле из 50 не было ни одного русского. */
  countryQuotas: CountryQuota[];
  /** Обязательные и запрещённые типы (см. TYPE_REQUIRE_SHARE). */
  requiredTypeIds: number[];
  excludedTypeIds: number[];
  entries: HistoryEntry[];
}

const LIST_STATUS_LABEL: Record<string, string> = {
  completed: 'посмотрел',
  watching: 'смотрит',
  rewatching: 'пересматривает',
  planned: 'хочет посмотреть',
  dropped: 'бросил',
  on_hold: 'отложил',
};

/** Сколько человек реально посмотрел по watch_progress — словами для модели. */
function describeProgress(p: {
  season: number | null;
  episode: number | null;
  position_seconds: number | null;
  duration_seconds: number | null;
}): string {
  const episode = p.episode ?? 1;
  const season = p.season ?? 1;
  if (season > 1 || episode > 1) {
    return `дошёл до ${season > 1 ? `${season} сезона, ` : ''}${episode} серии`;
  }
  if (p.duration_seconds && p.position_seconds) {
    const pct = Math.round((p.position_seconds / p.duration_seconds) * 100);
    if (pct >= 90) return 'досмотрел';
    return `посмотрел ${pct}% первой серии/фильма`;
  }
  return 'только открыл первую серию/фильм';
}

/** История одного пользователя по одному разделу: что исключить из
 *  кандидатов, какие жанры и страны он смотрит, и полный список со
 *  статусами для промпта. */
async function getUserHistory(
  supabase: SupabaseService,
  userId: string,
  contentType: CatalogType,
  dicts: Dictionaries,
): Promise<UserHistory> {
  const [{ data: wp }, { data: ul }] = await Promise.all([
    supabase
      .from('watch_progress')
      .select('shikimori_id, anime_title, season, episode, position_seconds, duration_seconds, updated_at')
      .eq('user_id', userId)
      .eq('content_type', contentType),
    supabase
      .from('user_list')
      .select('shikimori_id, anime_title, status, created_at')
      .eq('user_id', userId)
      .eq('content_type', contentType),
  ]);

  const progressRows = (wp ?? []) as {
    shikimori_id: number;
    anime_title: string;
    season: number | null;
    episode: number | null;
    position_seconds: number | null;
    duration_seconds: number | null;
    updated_at: string;
  }[];
  const listRows = (ul ?? []) as { shikimori_id: number; anime_title: string; status: string; created_at: string }[];

  // Один тайтл — одна строка: статус из списка (его поставил сам человек) +
  // фактический прогресс, если он есть. Свежее — первым, чтобы при обрезке
  // по WATCHED_ID_CAP терялось старое, а не случайное (раньше порядок был
  // произвольным порядком выдачи базы, и 5 из 45 названий у живого
  // пользователя просто не доходили до модели).
  const byId = new Map<number, HistoryEntry>();
  for (const p of progressRows) {
    byId.set(p.shikimori_id, { title: p.anime_title, status: describeProgress(p), at: p.updated_at });
  }
  for (const l of listRows) {
    const label = LIST_STATUS_LABEL[l.status] ?? l.status;
    const prev = byId.get(l.shikimori_id);
    byId.set(l.shikimori_id, {
      title: l.anime_title || prev?.title || '',
      status: prev ? `${label}; ${prev.status}` : label,
      at: prev && prev.at > l.created_at ? prev.at : l.created_at,
    });
  }

  const sorted = [...byId.entries()]
    .filter(([, e]) => e.title)
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .slice(0, WATCHED_ID_CAP);
  const watchedIds = sorted.map(([id]) => id);
  const entries = sorted.map(([, e]) => e);

  // Запланированное не исключаем: человек сам сказал, что хочет это
  // посмотреть, — значит оно уместно и в подборке. Убираем только то, что он
  // уже посмотрел, смотрит, пересматривает, бросил или начал без отметки в
  // списке (есть watch_progress).
  const excludedIds = [
    ...new Set([
      ...progressRows.map((r) => r.shikimori_id),
      ...listRows.filter((r) => r.status !== 'planned').map((r) => r.shikimori_id),
    ]),
  ].slice(0, WATCHED_ID_CAP);

  const empty = {
    watchedIds,
    excludedIds,
    genreIds: [],
    countryQuotas: [],
    requiredTypeIds: [],
    excludedTypeIds: [],
    entries,
  };
  if (watchedIds.length === 0) return empty;

  const batchId = await getActiveBatchId(supabase, contentType);
  if (!batchId) return empty;

  const { data: rowsWithTags } = await supabase
    .from(TABLE[contentType])
    .select(contentType === 'cinema' ? 'genre_ids, country_ids' : 'genre_ids')
    .eq('batch_id', batchId)
    .in(ID_COLUMN[contentType], watchedIds);

  const tagged = (rowsWithTags ?? []) as unknown as { genre_ids: number[] | null; country_ids?: number[] | null }[];

  const genreCount = new Map<number, number>();
  const countryCount = new Map<number, number>();
  const typeCount = new Map<number, number>();
  for (const r of tagged) {
    for (const g of r.genre_ids ?? []) {
      if (dicts.typeGenreIds.has(g)) {
        typeCount.set(g, (typeCount.get(g) ?? 0) + 1);
        continue;
      }
      genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
    }
    for (const c of r.country_ids ?? []) countryCount.set(c, (countryCount.get(c) ?? 0) + 1);
  }
  const genreIds = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);

  const countryQuotas = tagged.length === 0
    ? []
    : [...countryCount.entries()]
        .map(([id, n]) => ({ id, share: n / tagged.length }))
        .filter((c) => c.share >= COUNTRY_MIN_SHARE)
        .sort((a, b) => b.share - a.share)
        .slice(0, COUNTRY_MAX);

  const typeShare = (id: number) => (tagged.length === 0 ? 0 : (typeCount.get(id) ?? 0) / tagged.length);
  const typeIds = tagged.length === 0 ? [] : [...dicts.typeGenreIds];
  const requiredTypeIds = typeIds.filter((id) => typeShare(id) >= TYPE_REQUIRE_SHARE);
  const excludedTypeIds = typeIds.filter((id) => typeShare(id) < TYPE_EXCLUDE_SHARE);

  return { watchedIds, excludedIds, genreIds, countryQuotas, requiredTypeIds, excludedTypeIds, entries };
}

interface Candidate {
  id: number;
  title: string;
  year: number | null;
  genreIds: number[];
  countryIds: number[];
}

const YEAR_COLUMN: Record<CatalogType, string> = { anime: 'aired_year', cinema: 'year' };

/** Один запрос пула: жанры (overlaps), опционально одна страна, без
 *  исключённого и уже набранного, по популярности. */
async function queryPool(
  supabase: SupabaseService,
  contentType: CatalogType,
  batchId: string,
  opts: {
    skipIds: number[];
    genreIds: number[];
    requiredTypeIds: number[];
    excludedTypeIds: number[];
    countryId?: number;
    limit: number;
  },
): Promise<Candidate[]> {
  if (opts.limit <= 0) return [];
  const idCol = ID_COLUMN[contentType];
  const titleCol = TITLE_COLUMN[contentType];
  const yearCol = YEAR_COLUMN[contentType];
  const cols = `${idCol}, ${titleCol}, ${yearCol}, genre_ids${contentType === 'cinema' ? ', country_ids' : ''}`;

  let query = supabase.from(TABLE[contentType]).select(cols).eq('batch_id', batchId);

  if (opts.genreIds.length > 0) query = query.overlaps('genre_ids', opts.genreIds);
  if (opts.requiredTypeIds.length > 0) query = query.contains('genre_ids', opts.requiredTypeIds);
  if (opts.excludedTypeIds.length > 0) {
    query = query.not('genre_ids', 'ov', `{${opts.excludedTypeIds.join(',')}}`);
  }
  if (opts.countryId !== undefined) query = query.contains('country_ids', [opts.countryId]);
  if (opts.skipIds.length > 0) query = query.not(idCol, 'in', `(${opts.skipIds.join(',')})`);

  query =
    contentType === 'anime'
      ? query.order('popularity_rank', { ascending: true, nullsFirst: false })
      : query.order('popularity', { ascending: false, nullsFirst: false });

  const { data, error } = await query.limit(opts.limit);
  if (error) {
    console.error(`[recommendationsEngine] пул кандидатов ${contentType} не прочитался:`, error.message);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map((r) => ({
      id: Number(r[idCol]),
      title: (r[titleCol] as string | null) ?? '',
      year: (r[yearCol] as number | null) ?? null,
      genreIds: (r.genre_ids as number[] | null) ?? [],
      countryIds: (r.country_ids as number[] | null) ?? [],
    }))
    .filter((c) => Number.isFinite(c.id) && c.title !== '');
}

/** Пул кандидатов: по вкусу (пересечение жанров), без просмотренного и
 *  начатого — НЕ весь каталог, только то, что реально пойдёт в промпт
 *  модели. Если в истории заметны страны, пул делится на квоты по их долям
 *  (остаток — из любых стран), чтобы общая популярность не вытесняла,
 *  например, все русские сериалы. Запланированное остаётся в пуле: см.
 *  excludedIds в UserHistory. history=null — общий популярный пул. */
async function getCandidatePool(
  supabase: SupabaseService,
  contentType: CatalogType,
  history: UserHistory | null,
): Promise<Candidate[]> {
  const batchId = await getActiveBatchId(supabase, contentType);
  if (!batchId) return [];

  const excludedIds = history?.excludedIds ?? [];
  const genreIds = history?.genreIds ?? [];
  const quotas = history?.countryQuotas ?? [];
  const requiredTypeIds = history?.requiredTypeIds ?? [];
  const excludedTypeIds = history?.excludedTypeIds ?? [];

  // Тайтл бывает сразу нескольких стран, поэтому сумма долей может быть
  // больше 1 — сжимаем так, чтобы хотя бы десятая часть пула оставалась
  // «любой страны»: иначе человек не увидит ничего за пределами привычного.
  const shareSum = quotas.reduce((s, q) => s + q.share, 0);
  const scale = shareSum > 0.9 ? 0.9 / shareSum : 1;

  const picked: Candidate[] = [];
  for (const q of quotas) {
    const part = await queryPool(supabase, contentType, batchId, {
      skipIds: [...excludedIds, ...picked.map((c) => c.id)],
      genreIds,
      requiredTypeIds,
      excludedTypeIds,
      countryId: q.id,
      limit: Math.floor(CANDIDATE_LIMIT * q.share * scale),
    });
    picked.push(...part);
  }

  const rest = await queryPool(supabase, contentType, batchId, {
    skipIds: [...excludedIds, ...picked.map((c) => c.id)],
    genreIds,
    requiredTypeIds,
    excludedTypeIds,
    limit: CANDIDATE_LIMIT - picked.length,
  });
  return [...picked, ...rest];
}

/** Топ по популярности всего раздела — фоллбэк, когда у пользователя нет
 *  истории (или модель ничего не вернула), и общий guest-hero. */
async function getPopularPool(
  supabase: SupabaseService,
  contentType: CatalogType,
  limit: number,
): Promise<Candidate[]> {
  return getCandidatePool(supabase, contentType, null).then((all) => all.slice(0, limit));
}

interface RecommendedItem {
  id: number;
  reason: string | null;
}

/** «id: Название (2026; Россия; драма, комедия)» — год, страна и жанры
 *  нужны модели для новинок: про сериал 2026 года она по одному названию
 *  ничего не знает и раньше сочиняла причину наугад («мрачный нуар» у
 *  «Тайн Смолвиля», «криминальные детективы» у «Теда Лассо»). */
function describeCandidate(c: Candidate, dicts: Dictionaries): string {
  const meta = [
    c.year ? String(c.year) : null,
    c.countryIds.map((id) => dicts.countryNames.get(id)).filter(Boolean).slice(0, 2).join(', ') || null,
    c.genreIds
      .filter((id) => !dicts.typeGenreIds.has(id))
      .map((id) => dicts.genreNames.get(id)?.toLowerCase())
      .filter(Boolean)
      .slice(0, 4)
      .join(', ') || null,
  ].filter(Boolean);
  return `${c.id}: ${c.title}${meta.length > 0 ? ` (${meta.join('; ')})` : ''}`;
}

/**
 * Один вызов OpenRouter: строгий JSON со списком id из пула кандидатов.
 * Халлюцинированные id (не из пула) отбрасываются — модель это уже
 * подводило на других проектах, доверять её id вслепую нельзя.
 *
 * Выбирает модель только из пула, а не «что угодно из головы»: её знания
 * обрываются на дате обучения (новинок каталога она не знает), а
 * придуманный ею тайтл может просто отсутствовать в нашем каталоге.
 */
async function requestRecommendations(
  entries: HistoryEntry[],
  candidates: Candidate[],
  dicts: Dictionaries,
  /** Вызывается на HTTP 402 — кончились кредиты OpenRouter (см.
   *  lib/openrouterBalance.ts). */
  onPaymentRequired: () => void,
): Promise<RecommendedItem[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  // Молчаливый выход здесь раньше маскировал отсутствие ключа: крон отдавал
  // ok:true recommendationsWritten:0 без единой строки в логе, и понять,
  // ключа нет или модель просто ничего не выбрала, было нельзя.
  if (!apiKey) {
    console.error('[recommendationsEngine] OPENROUTER_API_KEY не задан — рекомендации пропускаются');
    return [];
  }
  if (candidates.length === 0) return [];

  const historyLine =
    entries.length > 0
      ? 'История пользователя (свежее — выше; «посмотрел/смотрит/дошёл до N серии» — сильный ' +
        'интерес, «только открыл» — слабый сигнал, могло не понравиться, «бросил» — не понравилось, ' +
        '«хочет посмотреть» — интерес без просмотра):\n' +
        entries.map((e) => `- ${e.title} — ${e.status}`).join('\n')
      : 'У пользователя пока нет истории просмотра — просто выбери самое достойное из списка.';

  const candidateLines = candidates.map((c) => describeCandidate(c, dicts)).join('\n');

  const prompt =
    `${historyLine}\n\n` +
    `Кандидаты (id: название (год; страна; жанры)):\n${candidateLines}\n\n` +
    `Выбери до ${RECOMMENDATION_LIMIT} тайтлов, которые стоит посмотреть дальше, ` +
    'в порядке убывания уверенности (лучший — первым). ' +
    'Учитывай, из каких стран пользователь смотрит, и держи похожую пропорцию. ' +
    // Каталог помечает часть детских мультсериалов («Маша и медведь»,
    // «Смешарики») просто как сериал-комедию без признака анимации — по
    // данным их из пула не отсечь, отсекает модель, которая их знает.
    'Не предлагай детские мультфильмы и мультсериалы, если в истории нет детского. ' +
    'Часть кандидатов — новинки, которых ты можешь не знать: суди о них по году, стране и жанрам ' +
    'и не придумывай им сюжет; причина должна опираться на эти данные или на то, что ты точно знаешь. ' +
    'Используй ТОЛЬКО id из списка кандидатов, ничего не придумывай. ' +
    'Ответь строго JSON без пояснений и без markdown-разметки: ' +
    '{"items":[{"id":number,"reason":"краткая причина на русском, не длиннее 12 слов"}]}';

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
      // openrouter.ai с этой VPS блокируется на уровне WAF («Access denied
      // by security policy», проверено вживую) — тот же класс сетевого
      // ограничения, что у api.themoviedb.org (см. lib/tmdb.ts), лечится
      // тем же туннелем. Сам туннель и OpenRouter проверены вживую curl'ом
      // (POST через тот же прокси отвечает за ~1с) — зависание было в
      // Node/undici: fetch с телом через кастомный dispatcher требует
      // duplex:'half', без него запрос повисает до собственного таймаута,
      // не долетев до сети.
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: vlessDispatcher(),
      duplex: 'half',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[recommendationsEngine] OpenRouter HTTP ${res.status}: ${body.slice(0, 500)}`);
      if (res.status === 402) onPaymentRequired();
      return [];
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      console.error('[recommendationsEngine] OpenRouter ответ без content:', JSON.stringify(data).slice(0, 500));
      return [];
    }

    let parsed: { items?: { id?: number; reason?: string }[] };
    try {
      parsed = JSON.parse(content) as { items?: { id?: number; reason?: string }[] };
    } catch {
      console.error('[recommendationsEngine] content не JSON:', content.slice(0, 500));
      return [];
    }

    const validIds = new Set(candidates.map((c) => c.id));
    const result = (parsed.items ?? [])
      .filter((it) => typeof it.id === 'number' && validIds.has(it.id))
      .slice(0, RECOMMENDATION_LIMIT)
      .map((it) => ({ id: it.id as number, reason: it.reason?.slice(0, 200) ?? null }));

    if (result.length === 0) {
      console.error(
        '[recommendationsEngine] модель не выбрала ни одного валидного id, сырой content:',
        content.slice(0, 500),
      );
    }

    return result;
  } catch (err) {
    console.error(
      '[recommendationsEngine] OpenRouter не ответил:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function replaceRecommendations(
  supabase: SupabaseService,
  userId: string,
  contentType: CatalogType,
  items: RecommendedItem[],
): Promise<void> {
  await supabase
    .from('user_recommendations')
    .delete()
    .eq('user_id', userId)
    .eq('content_type', contentType);

  if (items.length === 0) return;

  const rows = items.map((it, i) => ({
    user_id: userId,
    content_type: contentType,
    item_id: it.id,
    rank: i + 1,
    reason: it.reason,
    generated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('user_recommendations')
    .upsert(rows, { onConflict: 'user_id,content_type,rank' });
  if (error) {
    console.error('[recommendationsEngine] не записались рекомендации:', error.message);
  }
}

/** `!url.includes('?')` — та же проверка на «постоянную» ссылку Kitsu, что
 *  и в animeIndex.ts (часть ссылок подписана на 15 минут). */
function isStableKitsuUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('https://media.kitsu.app/') && !url.includes('?');
}

interface KitsuCoverResponse {
  data?: { attributes?: { externalId?: string }; relationships?: { item?: { data?: { id?: string } | null } } }[];
  included?: { id?: string; attributes?: { coverImage?: Record<string, string | null> | null } }[];
}

/**
 * coverImage Kitsu по shikimori_id (= MAL id, та же связка, что у постеров
 * в animeIndex.ts) — ТОЛЬКО для переданных id, не для всего каталога аниме:
 * это то, что отличает hero-обложку от полного индекса (см. миграцию 0042).
 */
async function fetchCoverImagesViaKitsu(malIds: number[]): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  if (malIds.length === 0) return found;

  for (let i = 0; i < malIds.length; i += KITSU_IDS_PER_REQUEST) {
    const chunk = malIds.slice(i, i + KITSU_IDS_PER_REQUEST);
    const params = new URLSearchParams({
      'filter[externalSite]': 'myanimelist/anime',
      'filter[externalId]': chunk.join(','),
      include: 'item',
      'page[limit]': String(KITSU_IDS_PER_REQUEST),
    });

    try {
      const res = await fetch(`${KITSU_URL}?${params}`, {
        headers: { Accept: 'application/vnd.api+json', 'User-Agent': 'MediaWatch MVP' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        console.error(`[recommendationsEngine] Kitsu ответил HTTP ${res.status} на пачку id`);
      } else {
        const json = (await res.json()) as KitsuCoverResponse;
        const items = new Map(
          (json.included ?? []).map((x) => [x.id ?? '', x.attributes?.coverImage ?? null]),
        );
        for (const row of json.data ?? []) {
          const malId = Number(row.attributes?.externalId);
          const itemId = row.relationships?.item?.data?.id ?? '';
          if (!Number.isFinite(malId)) continue;
          const cover = items.get(itemId);
          const url = [cover?.large, cover?.original, cover?.small].find(isStableKitsuUrl);
          if (url) found.set(malId, url);
        }
      }
    } catch (err) {
      console.error(
        '[recommendationsEngine] обложки Kitsu не пришли, пропускаю пачку:',
        err instanceof Error ? err.message : err,
      );
    }

    if (i + KITSU_IDS_PER_REQUEST < malIds.length) await sleep(KITSU_INTERVAL_MS);
  }

  return found;
}

/** backdrop_path (TMDB) уже лежит в cinema_index (см. миграцию 0043) —
 *  никакого похода в TMDB отсюда не требуется. */
async function fetchCinemaBackdropUrls(
  supabase: SupabaseService,
  kpIds: number[],
): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  if (kpIds.length === 0) return found;

  const batchId = await getActiveBatchId(supabase, 'cinema');
  if (!batchId) return found;

  const { data, error } = await supabase
    .from('cinema_index')
    .select('kp_id, backdrop_path')
    .eq('batch_id', batchId)
    .in('kp_id', kpIds);

  if (error) {
    console.error(`[recommendationsEngine] cinema_index backdrop_path запрос упал (${kpIds.length} id):`, error.message);
    return found;
  }

  for (const r of data ?? []) {
    const row = r as { kp_id: number; backdrop_path: string | null };
    if (row.backdrop_path) found.set(row.kp_id, `${TMDB_IMAGE_BASE}${row.backdrop_path}`);
  }

  return found;
}

export interface RefreshRecommendationsResult {
  usersProcessed: number;
  recommendationsWritten: number;
  /** Остаток кредитов OpenRouter в начале прогона (null — не узнали) и был
   *  ли хоть один отказ в оплате — чтобы по логу крона было видно причину
   *  пустых подборок. */
  openrouter: { remaining: number | null; paymentRequired: boolean };
  backdrops: { attempted: number; stored: number; missed: number; failed: number; errors: string[] };
}

/**
 * Точка входа крона. По каждому разделу (аниме/кино) отдельно: считает
 * рекомендации всем активным пользователям + guest-фоллбэк, докачивает
 * backdrop ВСЕГО списка рекомендаций (не только чьего-то одного «победителя»)
 * одним пакетом в конце. Какой конкретно тайтл станет hero — решает не
 * крон, а сам рендер главной (см. getHeroPick в lib/recommendations.ts):
 * он случайно выбирает один из уже закэшированных здесь при каждом заходе,
 * поэтому hero меняется на перезагрузке, а не залипает на весь день.
 */
export async function refreshRecommendations(): Promise<RefreshRecommendationsResult> {
  const supabase = createServiceClient();
  const userIds = await getActiveUserIds(supabase);
  const balance = await checkOpenRouterBalance();
  let paymentRequired = false;

  let recommendationsWritten = 0;
  // Полный ранжированный список каждого пользователя (или популярный
  // фоллбэк) — нужен только чтобы собрать множество id, которым может
  // понадобиться backdrop (см. ниже), выбор конкретного hero здесь больше
  // не происходит.
  const rankedByUser = new Map<string, Record<CatalogType, number[]>>();

  for (const contentType of ['anime', 'cinema'] as CatalogType[]) {
    const dicts = await getDictionaries(supabase, contentType);
    const popularPool = await getPopularPool(supabase, contentType, RECOMMENDATION_LIMIT);

    await mapWithConcurrency(userIds, OPENROUTER_CONCURRENCY, async (userId) => {
      const history = await getUserHistory(supabase, userId, contentType, dicts);
      const candidates =
        history.watchedIds.length > 0 ? await getCandidatePool(supabase, contentType, history) : popularPool;

      const pool = candidates.length > 0 ? candidates : popularPool;
      const items = await requestRecommendations(history.entries, pool, dicts, () => {
        paymentRequired = true;
      });
      const finalItems = items.length > 0 ? items : [];

      await replaceRecommendations(supabase, userId, contentType, finalItems);
      recommendationsWritten += finalItems.length;

      const ranked = finalItems.length > 0 ? finalItems.map((it) => it.id) : popularPool.map((c) => c.id);
      const prev = rankedByUser.get(userId) ?? { anime: [], cinema: [] };
      prev[contentType] = ranked;
      rankedByUser.set(userId, prev);
    });

    // Гость — общий популярный пул, персонализировать некого; попадает в
    // общий список на докачку обложек той же дорогой, что и все остальные.
    const prevGuest = rankedByUser.get(GUEST_TRACKING_KEY) ?? { anime: [], cinema: [] };
    prevGuest[contentType] = popularPool.map((c) => c.id);
    rankedByUser.set(GUEST_TRACKING_KEY, prevGuest);
  }

  // Union id'ов, которым вообще может понадобиться картинка — по каждому
  // пользователю (+ гостю) берём ВЕСЬ его ранжированный список.
  const animeIdsNeeded = new Set<number>();
  const cinemaIdsNeeded = new Set<number>();
  for (const ranked of rankedByUser.values()) {
    for (const id of ranked.anime) animeIdsNeeded.add(id);
    for (const id of ranked.cinema) cinemaIdsNeeded.add(id);
  }

  const [animeCoverMap, cinemaBackdropMap] = await Promise.all([
    fetchCoverImagesViaKitsu([...animeIdsNeeded]),
    fetchCinemaBackdropUrls(supabase, [...cinemaIdsNeeded]),
  ]);

  // Кэшируем backdrop ВСЕГО списка рекомендаций, у кого он вообще нашёлся —
  // именно из этого пула getHeroPick (lib/recommendations.ts) на каждом
  // заходе на главную случайно выбирает hero, поэтому нужны все, а не
  // только один «победитель».
  const backdropCandidates: BackdropCandidate[] = [
    ...[...animeIdsNeeded]
      .filter((id) => animeCoverMap.has(id))
      .map((id) => ({ kind: 'anime' as BackdropKind, id, url: animeCoverMap.get(id) as string })),
    ...[...cinemaIdsNeeded]
      .filter((id) => cinemaBackdropMap.has(id))
      .map((id) => ({ kind: 'cinema' as BackdropKind, id, url: cinemaBackdropMap.get(id) as string })),
  ];

  const cacheResult = await cacheBackdrops(backdropCandidates);

  // Кредиты могли кончиться посреди прогона, когда проверка в начале ещё
  // видела остаток, — баланс перечитываем, чтобы в уведомлении была
  // свежая цифра и верный дедуп-ключ.
  if (paymentRequired) await notifyAdminsAboutOpenRouter('empty', await fetchOpenRouterBalance());

  return {
    usersProcessed: userIds.length,
    recommendationsWritten,
    openrouter: { remaining: balance?.remaining ?? null, paymentRequired },
    backdrops: {
      attempted: cacheResult.attempted,
      stored: cacheResult.stored,
      missed: cacheResult.missed,
      failed: cacheResult.failed,
      errors: cacheResult.errors,
    },
  };
}

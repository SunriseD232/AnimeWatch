import { createServiceClient } from '@/lib/supabase/service';
import { mapWithConcurrency } from '@/lib/concurrency';
import { cacheBackdrops, type BackdropCandidate } from '@/lib/backdropCache';
import { localBackdropUrl, type BackdropKind } from '@/lib/backdropPath';
import { GUEST_HERO_USER_ID } from '@/lib/recommendations';
import { vlessDispatcher } from '@/lib/net/vlessProxy';
import type { ContentType } from '@/lib/types';

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

const CANDIDATE_LIMIT = 50;
const RECOMMENDATION_LIMIT = 12;
const WATCHED_ID_CAP = 300;

const KITSU_URL = 'https://kitsu.io/api/edge/mappings';
const KITSU_IDS_PER_REQUEST = 20;
const KITSU_INTERVAL_MS = 700;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w1280';

type SupabaseService = ReturnType<typeof createServiceClient>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TABLE: Record<ContentType, string> = { anime: 'anime_index', cinema: 'cinema_index' };
const STATE_TABLE: Record<ContentType, string> = {
  anime: 'anime_index_state',
  cinema: 'cinema_index_state',
};
const ID_COLUMN: Record<ContentType, string> = { anime: 'shikimori_id', cinema: 'kp_id' };
const TITLE_COLUMN: Record<ContentType, string> = { anime: 'russian', cinema: 'title' };

async function getActiveBatchId(
  supabase: SupabaseService,
  contentType: ContentType,
): Promise<string | null> {
  const { data } = await supabase
    .from(STATE_TABLE[contentType])
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();
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

interface UserHistory {
  watchedIds: number[];
  genreIds: number[];
  watchedTitles: string[];
}

/** История одного пользователя по одному разделу: что смотрел/запланировал
 *  (для исключения из кандидатов) и какие жанры смотрел чаще всего (для
 *  смещения пула кандидатов в сторону его вкуса). */
async function getUserHistory(
  supabase: SupabaseService,
  userId: string,
  contentType: ContentType,
): Promise<UserHistory> {
  const [{ data: wp }, { data: ul }] = await Promise.all([
    supabase
      .from('watch_progress')
      .select('shikimori_id, anime_title')
      .eq('user_id', userId)
      .eq('content_type', contentType),
    supabase
      .from('user_list')
      .select('shikimori_id, anime_title')
      .eq('user_id', userId)
      .eq('content_type', contentType),
  ]);

  const rows = [...(wp ?? []), ...(ul ?? [])] as { shikimori_id: number; anime_title: string }[];
  const watchedIds = [...new Set(rows.map((r) => r.shikimori_id))].slice(0, WATCHED_ID_CAP);
  const watchedTitles = [...new Set(rows.map((r) => r.anime_title).filter(Boolean))].slice(0, 40);

  if (watchedIds.length === 0) return { watchedIds: [], genreIds: [], watchedTitles: [] };

  const batchId = await getActiveBatchId(supabase, contentType);
  if (!batchId) return { watchedIds, genreIds: [], watchedTitles };

  const { data: rowsWithGenres } = await supabase
    .from(TABLE[contentType])
    .select('genre_ids')
    .eq('batch_id', batchId)
    .in(ID_COLUMN[contentType], watchedIds);

  const genreCount = new Map<number, number>();
  for (const r of rowsWithGenres ?? []) {
    for (const g of (r as { genre_ids: number[] | null }).genre_ids ?? []) {
      genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
    }
  }
  const genreIds = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);

  return { watchedIds, genreIds, watchedTitles };
}

interface Candidate {
  id: number;
  title: string;
}

/** Пул кандидатов: по вкусу (пересечение жанров), без уже просмотренного/
 *  запланированного, топ по популярности — НЕ весь каталог, только то, что
 *  реально пойдёт в промпт модели. */
async function getCandidatePool(
  supabase: SupabaseService,
  contentType: ContentType,
  watchedIds: number[],
  genreIds: number[],
): Promise<Candidate[]> {
  const batchId = await getActiveBatchId(supabase, contentType);
  if (!batchId) return [];

  const idCol = ID_COLUMN[contentType];
  const titleCol = TITLE_COLUMN[contentType];

  let query = supabase
    .from(TABLE[contentType])
    .select(`${idCol}, ${titleCol}`)
    .eq('batch_id', batchId);

  if (genreIds.length > 0) query = query.overlaps('genre_ids', genreIds);
  if (watchedIds.length > 0) query = query.not(idCol, 'in', `(${watchedIds.join(',')})`);

  query =
    contentType === 'anime'
      ? query.order('popularity_rank', { ascending: true, nullsFirst: false })
      : query.order('popularity', { ascending: false, nullsFirst: false });

  const { data, error } = await query.limit(CANDIDATE_LIMIT);
  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[])
    .map((r) => ({ id: Number(r[idCol]), title: (r[titleCol] as string | null) ?? '' }))
    .filter((c) => Number.isFinite(c.id) && c.title !== '');
}

/** Топ по популярности всего раздела — фоллбэк, когда у пользователя нет
 *  истории (или модель ничего не вернула), и общий guest-hero. */
async function getPopularPool(
  supabase: SupabaseService,
  contentType: ContentType,
  limit: number,
): Promise<Candidate[]> {
  return getCandidatePool(supabase, contentType, [], []).then((all) => all.slice(0, limit));
}

interface RecommendedItem {
  id: number;
  reason: string | null;
}

/**
 * Один вызов OpenRouter: строгий JSON со списком id из пула кандидатов.
 * Халлюцинированные id (не из пула) отбрасываются — модель это уже
 * подводило на других проектах, доверять её id вслепую нельзя.
 */
async function requestRecommendations(
  watchedTitles: string[],
  candidates: Candidate[],
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
    watchedTitles.length > 0
      ? `Пользователь смотрел: ${watchedTitles.join(', ')}.`
      : 'У пользователя пока нет истории просмотра — просто выбери самое достойное из списка.';

  const candidateLines = candidates.map((c) => `${c.id}: ${c.title}`).join('\n');

  const prompt =
    `${historyLine}\n\n` +
    `Кандидаты (id: название):\n${candidateLines}\n\n` +
    `Выбери до ${RECOMMENDATION_LIMIT} тайтлов, которые стоит посмотреть дальше, ` +
    'в порядке убывания уверенности (лучший — первым). ' +
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
      // тем же туннелем.
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: vlessDispatcher(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[recommendationsEngine] OpenRouter HTTP ${res.status}: ${body.slice(0, 500)}`);
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
  contentType: ContentType,
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

  const { data } = await supabase
    .from('cinema_index')
    .select('kp_id, backdrop_path')
    .eq('batch_id', batchId)
    .in('kp_id', kpIds);

  for (const r of data ?? []) {
    const row = r as { kp_id: number; backdrop_path: string | null };
    if (row.backdrop_path) found.set(row.kp_id, `${TMDB_IMAGE_BASE}${row.backdrop_path}`);
  }

  return found;
}

interface HeroPick {
  userId: string;
  itemId: number;
  rawUrl: string;
}

export interface RefreshRecommendationsResult {
  usersProcessed: number;
  recommendationsWritten: number;
  heroPicksWritten: number;
  backdrops: { attempted: number; stored: number; missed: number; failed: number };
}

/**
 * Точка входа крона. По каждому разделу (аниме/кино) отдельно: считает
 * рекомендации всем активным пользователям + guest-фоллбэк, выбирает hero
 * (первый по рангу рекомендации, у которого нашлась обложка — см. план:
 * упрощение относительно «бонуса за популярность» намеренное, т.к. сам пул
 * кандидатов уже отсортирован по популярности ДО того, как его увидела
 * модель), докачивает нужные backdrop'ы одним пакетом в конце.
 */
export async function refreshRecommendations(): Promise<RefreshRecommendationsResult> {
  const supabase = createServiceClient();
  const userIds = await getActiveUserIds(supabase);

  let recommendationsWritten = 0;
  const heroCandidatesByType: Record<ContentType, HeroPick[]> = { anime: [], cinema: [] };
  // Кандидат на hero каждого пользователя — весь его ранжированный список
  // (или популярный фоллбэк), а не только первый ранг: если у топ-1 нет
  // обложки, идём дальше по списку.
  const rankedByUser = new Map<string, Record<ContentType, number[]>>();

  for (const contentType of ['anime', 'cinema'] as ContentType[]) {
    const popularPool = await getPopularPool(supabase, contentType, RECOMMENDATION_LIMIT);

    await mapWithConcurrency(userIds, OPENROUTER_CONCURRENCY, async (userId) => {
      const history = await getUserHistory(supabase, userId, contentType);
      const candidates =
        history.watchedIds.length > 0
          ? await getCandidatePool(supabase, contentType, history.watchedIds, history.genreIds)
          : popularPool;

      const pool = candidates.length > 0 ? candidates : popularPool;
      const items = await requestRecommendations(history.watchedTitles, pool);
      const finalItems = items.length > 0 ? items : [];

      await replaceRecommendations(supabase, userId, contentType, finalItems);
      recommendationsWritten += finalItems.length;

      const ranked = finalItems.length > 0 ? finalItems.map((it) => it.id) : popularPool.map((c) => c.id);
      const prev = rankedByUser.get(userId) ?? { anime: [], cinema: [] };
      prev[contentType] = ranked;
      rankedByUser.set(userId, prev);
    });

    // Гость — общий пик, всегда из популярного (персонализировать некого).
    const prevGuest = rankedByUser.get(GUEST_HERO_USER_ID) ?? { anime: [], cinema: [] };
    prevGuest[contentType] = popularPool.map((c) => c.id);
    rankedByUser.set(GUEST_HERO_USER_ID, prevGuest);
  }

  // Union id'ов, которым вообще может понадобиться картинка — по каждому
  // пользователю (+ гостю) берём ВЕСЬ его ранжированный список: реальный
  // hero определится ниже, как только выяснится, у кого есть обложка.
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

  const urlMap: Record<ContentType, Map<number, string>> = {
    anime: animeCoverMap,
    cinema: cinemaBackdropMap,
  };

  for (const [userId, ranked] of rankedByUser) {
    for (const contentType of ['anime', 'cinema'] as ContentType[]) {
      const map = urlMap[contentType];
      const hit = ranked[contentType].find((id) => map.has(id));
      if (hit === undefined) continue;
      heroCandidatesByType[contentType].push({ userId, itemId: hit, rawUrl: map.get(hit) as string });
    }
  }

  const allHeroPicks = [...heroCandidatesByType.anime.map((h) => ({ ...h, contentType: 'anime' as const })), ...heroCandidatesByType.cinema.map((h) => ({ ...h, contentType: 'cinema' as const }))];

  const backdropCandidates: BackdropCandidate[] = allHeroPicks.map((h) => ({
    kind: h.contentType as BackdropKind,
    id: h.itemId,
    url: h.rawUrl,
  }));

  const cacheResult = await cacheBackdrops(backdropCandidates);

  const heroRows = allHeroPicks.map((h) => {
    const localOk = cacheResult.resolved.get(`${h.contentType}:${h.itemId}`) ?? false;
    return {
      user_id: h.userId,
      content_type: h.contentType,
      item_id: h.itemId,
      backdrop_url: localOk ? localBackdropUrl(h.contentType as BackdropKind, h.itemId) : h.rawUrl,
      generated_at: new Date().toISOString(),
    };
  });

  if (heroRows.length > 0) {
    const { error } = await supabase
      .from('hero_pick')
      .upsert(heroRows, { onConflict: 'user_id,content_type' });
    if (error) console.error('[recommendationsEngine] не записался hero_pick:', error.message);
  }

  return {
    usersProcessed: userIds.length,
    recommendationsWritten,
    heroPicksWritten: heroRows.length,
    backdrops: {
      attempted: cacheResult.attempted,
      stored: cacheResult.stored,
      missed: cacheResult.missed,
      failed: cacheResult.failed,
    },
  };
}

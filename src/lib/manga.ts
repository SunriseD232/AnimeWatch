import { getCachedJson } from '@/lib/cache/apiCache';
import { singleFlight } from '@/lib/singleFlight';
import { taxonNames } from '@/lib/catalogTaxonomy';
import { decodeHtmlEntities } from '@/lib/sources/text';
import { wordSearchFilter } from '@/lib/indexSearch';
import { signImageUrlWithHeaders } from '@/lib/extract/proxy';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  MANGALIB_DIR_PREFIX,
  MANGALIB_KEY_OFFSET,
  getMangaLibDetails,
  isMangaLibDir,
  mangaLibCover,
  mangaLibSiteUrl,
} from '@/lib/sources/mangalib';
import {
  formatMangaChapterLabel,
  type MangaChapter,
  type MangaChapterContent,
  type MangaDetails,
  type MangaPage,
  type MangaSummary,
} from '@/lib/mangaShared';

/**
 * Манга с Remanga.
 *
 * Почему API, а не парсинг сайта. У Remanga есть публичный JSON API
 * (`api.remanga.org/api`), который отдаёт каталог, поиск, карточку тайтла,
 * оглавление и страницы главы. HTML-страницы того же сайта — клиентский
 * Next.js: парсить их значило бы ловить хеши чанков и ломаться на каждом
 * редизайне.
 *
 * Что НЕ храним. Страницы главы — самый тяжёлый кусок: они запрашиваются при
 * открытии главы, подписываются через /api/proxy/raw и сразу отдаются в
 * браузер. В Postgres попадают только id, слаг и лёгкие метаданные витрины
 * (см. миграцию 0056). Описание, жанры и оглавление всегда берутся живьём.
 *
 * Ограничение источника. Платные главы Remanga отдают `is_paid = true`, а
 * запрос их страниц — 401. Обойти это нельзя: картинки физически не приходят,
 * пока глава не куплена. Такие главы видны в оглавлении заблокированными.
 */

const API_BASE = 'https://api.remanga.org';
const SITE_BASE = 'https://remanga.org';

const USER_AGENT = 'MediaWatch/1.0 (+manga; contact: site admin)';

/** Таймаут одного запроса к Remanga. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Поиск и карточка меняются нечасто; главы — чаще, но не ежесекундно. */
const SEARCH_TTL_SECONDS = 10 * 60;
const TITLE_TTL_SECONDS = 30 * 60;
const CHAPTERS_TTL_SECONDS = 30 * 60;

/** Remanga отдаёт не больше 100 глав на страницу. */
const CHAPTERS_PER_PAGE = 100;

/** Предохранитель от бесконечной пагинации. 60 × 100 = 6000 глав. */
const MAX_CHAPTER_PAGES = 60;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asInt(value: unknown): number | null {
  const n = asNumber(value);
  return n == null ? null : Math.round(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────── Общие запросы ───────────────────────────

/**
 * GET JSON с API Remanga. Ошибку/таймаут не бросаем: страница манги должна
 * уметь показать запись из собственного индекса, даже если источник лежит.
 */
async function apiJson(path: string): Promise<JsonObject | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        Origin: SITE_BASE,
        Referer: `${SITE_BASE}/`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn(`[manga] ${path}: HTTP ${res.status}`);
      return null;
    }

    return asObject(await res.json());
  } catch (err) {
    console.warn(
      `[manga] ${path}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * То же, но для fetcher'а кэша: пустой ответ — это ошибка, а не значение.
 * Иначе временный сбой Remanga закэшировался бы на полчаса (getCachedJson
 * кэширует null/[] так же, как настоящие данные), и раздел оставался бы
 * пустым даже после восстановления источника.
 */
async function apiJsonOrThrow(path: string): Promise<JsonObject> {
  const json = await apiJson(path);
  if (!json) throw new Error(`Remanga не ответил: ${path}`);
  return json;
}

/**
 * Кэш поверх Supabase — тот же, что у книг и ранобэ. Нужен, чтобы оглавление
 * не запрашивалось заново при каждом переходе по главам.
 */
async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  let started = false;
  try {
    return await getCachedJson<T>(key, ttlSeconds, () => {
      started = true;
      return fetcher();
    });
  } catch (err) {
    if (started) throw err;
    return fetcher();
  }
}

// ─────────────────────────── Нормализация ───────────────────────────

/**
 * Абсолютный адрес медиа Remanga. В разных ответах обложка приходит как
 * `/media/...`, как `titles/...` (без `/media`) или полным URL; приводим всё
 * к одному виду. Остальные страницы главы приходят полными URL.
 */
function absoluteMediaUrl(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/media/')) return `${SITE_BASE}${value}`;
  if (value.startsWith('media/')) return `${SITE_BASE}/${value}`;
  if (value.startsWith('/')) return `${SITE_BASE}${value}`;
  return `${SITE_BASE}/media/${value}`;
}

/**
 * Подпись обложки/страницы через /api/proxy/raw. Без секрета (локальная
 * сборка без .env) отдаём прямой адрес: картинка может не загрузиться, но
 * заглушка из-за отсутствующего секрета — хуже.
 *
 * С Referer сайта: хранилище страниц глав (img.reimg2.org) с 24.10.2026
 * отвечает 403 на запрос без него — главы открывались пустыми, с одними
 * подписями картинок. С Referer remanga.org отдаёт 200, и с адреса VPS, и
 * через туннель (проверено).
 */
function signMedia(raw: string | null): string | null {
  const absolute = absoluteMediaUrl(raw);
  if (!absolute) return null;
  try {
    return signImageUrlWithHeaders(absolute, { Referer: `${SITE_BASE}/` });
  } catch {
    return absolute;
  }
}

/** Обложка из разных форм ответа: `img.high`, `cover.high`, строка. */
function coverOf(item: JsonObject): string | null {
  const direct = asText(item.cover);
  if (direct) return signMedia(direct);

  // У detail-ответа `img` содержит /media, а `cover` иногда без него.
  // Поэтому img идёт первым.
  for (const container of ['img', 'cover']) {
    const obj = asObject(item[container]);
    if (!obj) continue;
    for (const key of ['high', 'mid', 'low', 'original']) {
      const value = asText(obj[key]);
      if (value) return signMedia(value);
    }
  }

  return null;
}

/** `type` у списка/карточки — строка, иногда объект `{id, name}`. */
function kindOf(item: JsonObject): string | null {
  const direct = asText(item.type);
  if (direct) return direct;
  const obj = asObject(item.type);
  return obj ? asText(obj.name) : null;
}

/** `status` у списка — объект `{id, name}`, у части ответов — строка. */
function statusOf(item: JsonObject): string | null {
  const direct = asText(item.status);
  if (direct) return direct;
  const obj = asObject(item.status);
  return obj ? asText(obj.name) : null;
}

/** Названия из массива `{id, name}`. */
function namesOf(value: unknown): string[] {
  const seen = new Set<string>();
  for (const entry of asArray(value)) {
    const obj = asObject(entry);
    const name = obj ? asText(obj.name) : asText(entry);
    if (name) seen.add(name);
  }
  return [...seen];
}

/** `another_name` бывает строкой или массивом строк. */
function namesText(value: unknown): string | null {
  if (typeof value === 'string') return asText(value);
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => asText(entry))
      .filter((entry): entry is string => entry !== null)
      .join(', ');
    return joined || null;
  }
  return null;
}

/** Расшифровка HTML-сущностей, которые встречаются в описаниях. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, '&');
}

/** Описание приходит HTML-ом; в карточке показываем обычным текстом. */
function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

/**
 * Витрина/поиск → общая карточка. Возвращает null, если запись битая: без
 * `dir` мы всё равно не сможем открыть тайтл.
 */
export function normalizeManga(item: unknown): MangaSummary | null {
  const obj = asObject(item);
  if (!obj) return null;

  const id = asInt(obj.id);
  const dir = asText(obj.dir);
  if (id == null || id <= 0 || !dir) return null;

  const title =
    decodeHtmlEntities(asText(obj.main_name)) ??
    decodeHtmlEntities(asText(obj.rus_name)) ??
    decodeHtmlEntities(asText(obj.secondary_name)) ??
    decodeHtmlEntities(asText(obj.en_name));
  if (!title) return null;

  const secondary = decodeHtmlEntities(asText(obj.secondary_name));
  const english = decodeHtmlEntities(asText(obj.en_name));
  const originalTitle =
    secondary && secondary !== title
      ? secondary
      : english && english !== title
        ? english
        : null;

  const another = namesText(obj.another_name);
  const alternativeTitle =
    another && another !== title && another !== originalTitle ? another : null;

  return {
    id,
    dir,
    title,
    originalTitle,
    alternativeTitle,
    kind: kindOf(obj),
    status: statusOf(obj),
    year: asInt(obj.issue_year),
    rating: asNumber(obj.avg_rating),
    votes: asInt(obj.total_votes) ?? asInt(obj.count_rating),
    views: asInt(obj.total_views),
    chaptersCount: asInt(obj.count_chapters),
    genres: taxonNames(obj.genres),
    // «Категории» у Remanga/Renovels — это теги.
    tags: taxonNames(obj.categories),
    coverUrl: coverOf(obj),
    sourceUrl: `${SITE_BASE}/manga/${encodeURIComponent(dir)}/main`,
  };
}

// ─────────────────────────── Поиск и каталог ───────────────────────────

export interface MangaSearchResult {
  items: MangaSummary[];
  total: number;
  hasNext: boolean;
}

/**
 * Живой поиск по названию. Remanga сама разбивает выдачу на страницы и
 * отдаёт по 20 записей (count/limit поиск игнорирует), поэтому фиксируем
 * пагинацию по `props`.
 */
export async function searchManga(query: string, page = 1): Promise<MangaSearchResult> {
  const q = query.trim();
  if (!q) return { items: [], total: 0, hasNext: false };

  const key = `manga:search:${q}:${page}`;
  try {
    return await cachedJson<MangaSearchResult>(key, SEARCH_TTL_SECONDS, async () => {
      const json = await apiJsonOrThrow(
        `/api/search/?query=${encodeURIComponent(q)}&page=${page}`,
      );

      const items = asArray(json.content)
        .map(normalizeManga)
        .filter((x): x is MangaSummary => x !== null);

      const props = asObject(json.props);
      const total = asInt(props?.total_items) ?? items.length;
      const totalPages = asInt(props?.total_pages) ?? page;
      const currentPage = asInt(props?.page) ?? page;

      return {
        items,
        total,
        hasNext: currentPage < totalPages && items.length > 0,
      };
    });
  } catch {
    return { items: [], total: 0, hasNext: false };
  }
}

export interface MangaCatalogPage {
  items: MangaSummary[];
  total: number;
  totalPages: number;
}

/**
 * Одна страница витрины Remanga. Без кэша: это ходит только ночной крон
 * (lib/mangaIndex.ts), а ему нужны свежие данные.
 *
 * Допустимые сортировки проверены живьём: `-views`, `-rating`,
 * `-count_chapters`, `-id`. Остальные (`-count_rating`, `-count_bookmarks`)
 * отвечают 400 — их в списке нет намеренно.
 */
export async function fetchMangaCatalogPage(options: {
  ordering: string;
  page: number;
  count?: number;
}): Promise<MangaCatalogPage> {
  // Remanga отвечает 400 на count > 30 («значение должно быть меньше либо
  // равно 30»), поэтому 30 — проверенный максимум, а не догадка.
  const count = Math.min(30, Math.max(1, options.count ?? 30));
  const params = new URLSearchParams({
    count: String(count),
    page: String(options.page),
    ordering: options.ordering,
  });

  const json = await apiJson(`/api/search/catalog/?${params.toString()}`);
  if (!json) return { items: [], total: 0, totalPages: 0 };

  const items = asArray(json.content)
    .map(normalizeManga)
    .filter((x): x is MangaSummary => x !== null);

  const props = asObject(json.props);
  const total = asInt(props?.total_items) ?? items.length;
  const totalPages = asInt(props?.total_pages) ?? options.page;

  return { items, total, totalPages };
}

// ─────────────────────────── Тайтл и главы ───────────────────────────

/**
 * Живая карточка тайтла. Если источник недоступен, но слаг уже есть в нашем
 * индексе, возвращаем лёгкую запись оттуда с `sourceAvailable = false` —
 * страница покажет, что оглавление сейчас не загрузить, вместо 404.
 */
export async function getMangaDetails(dir: string): Promise<MangaDetails | null> {
  const clean = dir.trim();
  if (!clean) return null;
  if (isMangaLibDir(clean)) return getMangaLibCard(clean);

  const fallback = await getMangaByDir(clean);

  let json: JsonObject | null = null;
  try {
    json = await cachedJson<JsonObject>(
      `manga:title:${clean}`,
      TITLE_TTL_SECONDS,
      () => apiJsonOrThrow(`/api/titles/${encodeURIComponent(clean)}/`),
    );
  } catch {
    json = null;
  }
  const content = json ? asObject(json.content) : null;

  if (!content) {
    if (!fallback) return null;
    return {
      ...fallback,
      description: null,
      genres: [],
      categories: [],
      branchId: null,
      firstChapterId: null,
      sourceAvailable: false,
    };
  }

  const summary = normalizeManga(content) ?? fallback;
  if (!summary) return null;

  const branches = asArray(content.branches);
  const firstBranch = asObject(branches[0]);
  const branchId = asInt(firstBranch?.id) ?? asInt(content.branch_id);

  const firstChapter = asObject(content.first_chapter);
  const firstChapterId = asInt(firstChapter?.id) ?? asInt(content.first_chapter_id);

  return {
    ...summary,
    // Слаг из ответа надёжнее: в базе он мог быть записан с другим регистром.
    dir: summary.dir || clean,
    description: stripHtml(asText(content.description)),
    genres: namesOf(content.genres),
    categories: namesOf(content.categories),
    branchId,
    firstChapterId,
    sourceAvailable: true,
  };
}

/**
 * Карточка тайтла, которого нет у Remanga, — только с MangaLib (dir
 * «ml-<slug_url>», см. lib/mangalibCatalog.ts). Оглавления у Remanga для него
 * нет (branchId = null): главы берёт каноническая ось из MangaLib (seed по
 * slug_url, см. /api/sources/resolve). Источник не ответил — запись из индекса.
 */
async function getMangaLibCard(dir: string): Promise<MangaDetails | null> {
  const fallback = await getMangaByDir(dir);
  let live: Awaited<ReturnType<typeof getMangaLibDetails>> = null;
  try {
    live = await cachedJson(`manga:mangalib:${dir}`, TITLE_TTL_SECONDS, async () => {
      const details = await getMangaLibDetails(dir.slice(MANGALIB_DIR_PREFIX.length));
      if (!details) throw new Error('MangaLib не ответил');
      return details;
    });
  } catch {
    live = null;
  }
  if (!live) {
    if (!fallback) return null;
    return {
      ...fallback,
      description: null,
      genres: [],
      categories: [],
      branchId: null,
      firstChapterId: null,
      sourceAvailable: false,
    };
  }
  const slug = dir.slice(MANGALIB_DIR_PREFIX.length);
  return {
    id: fallback?.id ?? MANGALIB_KEY_OFFSET + live.id,
    dir,
    title: live.rusName ?? live.engName ?? live.name ?? fallback?.title ?? 'Без названия',
    originalTitle: live.engName ?? live.name,
    // Все альтернативные названия — для подписи и сопоставления с другими
    // источниками (MangaDex, SelfManga ищут по ним).
    alternativeTitle: [live.name, ...live.otherNames].filter(Boolean).join(' / ') || null,
    kind: live.kind,
    status: live.status,
    year: live.year,
    rating: live.rating,
    votes: live.votes,
    views: null,
    chaptersCount: live.chaptersCount,
    coverUrl: mangaLibCover(live.coverRaw) ?? fallback?.coverUrl ?? null,
    sourceUrl: mangaLibSiteUrl(slug),
    description: live.description,
    genres: live.genres,
    categories: [],
    branchId: null,
    firstChapterId: null,
    sourceAvailable: true,
  };
}

function normalizeChapter(value: unknown, fallbackIndex: number): MangaChapter | null {
  const obj = asObject(value);
  if (!obj) return null;

  const id = asInt(obj.id);
  if (id == null || id <= 0) return null;

  const rawIndex = asInt(obj.index);
  const index = rawIndex != null && rawIndex > 0 ? rawIndex : fallbackIndex;
  const tome = Math.max(1, asInt(obj.tome) ?? 1);
  const number = asText(obj.chapter) ?? '';
  const name = asText(obj.name) ?? '';
  const isPaid = obj.is_paid === true;
  const isFreeToday = obj.is_free_today === true;

  return {
    id,
    index,
    tome,
    number,
    name,
    isPaid,
    isFreeToday,
    isReadable: !isPaid || isFreeToday,
    label: formatMangaChapterLabel({ index, tome, number, name }),
  };
}

/**
 * Полное оглавление ветки. Remanga не отдаёт общий `total` и `next`, но
 * честно листается по `page` до короткой/пустой страницы. Максимум — 100
 * записей, поэтому 60 страниц покрывают даже очень длинные тайтлы.
 *
 * `expectedCount` (обычно `count_chapters` из карточки) позволяет не угадывать
 * число страниц, а сразу запрашивать их пачками по четыре: у «Пика боевых
 * искусств» почти 4000 глав, и последовательные 40 запросов держали бы
 * страницу открытой десятки секунд. Если счётчик врёт (он может учитывать
 * другие ветки), пачка из одних пустых страниц останавливает проход.
 *
 * Кэш на полчаса: новые главы у источника выходят не каждую минуту.
 */
export async function listMangaChapters(
  branchId: number,
  expectedCount = 0,
): Promise<MangaChapter[]> {
  if (!Number.isSafeInteger(branchId) || branchId <= 0) return [];

  return cachedJson<MangaChapter[]>(
    `manga:chapters:${branchId}`,
    CHAPTERS_TTL_SECONDS,
    async () => {
      const byId = new Map<number, MangaChapter>();

      const take = (results: unknown[]) => {
        for (const entry of results) {
          const chapter = normalizeChapter(entry, byId.size + 1);
          if (chapter) byId.set(chapter.id, chapter);
        }
      };

      const pagePath = (page: number) =>
        `/api/titles/chapters/?branch_id=${branchId}` +
        `&count=${CHAPTERS_PER_PAGE}&page=${page}&ordering=index`;

      const knownPages =
        expectedCount > 0
          ? Math.min(
              MAX_CHAPTER_PAGES,
              Math.max(1, Math.ceil(expectedCount / CHAPTERS_PER_PAGE)),
            )
          : 0;

      if (knownPages > 0) {
        const CONCURRENCY = 4;
        let lastPage = 0;
        let lastPageLength = 0;
        let stoppedEarly = false;

        for (
          let start = 1;
          start <= knownPages;
          start += CONCURRENCY
        ) {
          const pages = Array.from(
            { length: Math.min(CONCURRENCY, knownPages - start + 1) },
            (_, i) => start + i,
          );

          const results = await Promise.all(
            pages.map(async (page) => {
              const json = await apiJsonOrThrow(pagePath(page));
              return asArray(json.content);
            }),
          );

          let gotAnything = false;
          results.forEach((pageItems, i) => {
            if (pageItems.length > 0) gotAnything = true;
            lastPage = pages[i];
            lastPageLength = pageItems.length;
            take(pageItems);
          });

          // Счётчик мог покрывать несколько веток: дальше только пусто.
          if (!gotAnything) {
            stoppedEarly = true;
            break;
          }
          if (start + CONCURRENCY <= knownPages) await sleep(150);
        }

        // `count_chapters` мог отстать от оглавления или посчитаться по другой
        // ветке. Если последняя ожидаемая страница была полной, проверяем, нет
        // ли следующей, — иначе новые главы терялись бы до истечения кэша.
        if (
          !stoppedEarly &&
          lastPage === knownPages &&
          lastPageLength === CHAPTERS_PER_PAGE
        ) {
          for (
            let page = knownPages + 1;
            page <= MAX_CHAPTER_PAGES;
            page++
          ) {
            const json = await apiJsonOrThrow(pagePath(page));
            const results = asArray(json.content);
            take(results);
            if (results.length < CHAPTERS_PER_PAGE) break;
            await sleep(120);
          }
        }
      } else {
        for (let page = 1; page <= MAX_CHAPTER_PAGES; page++) {
          const json = await apiJsonOrThrow(pagePath(page));
          const results = asArray(json.content);
          take(results);

          // Короткая страница — последняя. Ровно 100 может означать, что есть
          // ещё одна; её проверит следующий проход.
          if (results.length < CHAPTERS_PER_PAGE) break;
          await sleep(120);
        }
      }

      return [...byId.values()].sort((a, b) => a.index - b.index || a.id - b.id);
    },
  ).catch(() => []);
}

/**
 * Страницы одной главы. Не кэшируется: URL картинок живые, а сама глава —
 * ровно тот «тяжёлый» контент, который решено не хранить. Платные главы
 * сюда даже не запрашиваются (см. читатель), но если источник всё же ответит
 * 401, вернём null — читатель покажет заглушку.
 */
export async function getMangaChapterById(
  chapterId: number,
): Promise<MangaChapterContent | null> {
  if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return null;

  const json = await apiJson(`/api/titles/chapters/${chapterId}/`);
  const content = json ? asObject(json.content) : null;
  if (!content) return null;

  const pages = normalizePages(content.pages);

  return {
    id: asInt(content.id) ?? chapterId,
    titleId: asInt(content.title_id) ?? 0,
    index: asInt(content.index) ?? 0,
    tome: Math.max(1, asInt(content.tome) ?? 1),
    number: asText(content.chapter) ?? '',
    name: asText(content.name) ?? '',
    isPaid: content.is_paid === true,
    isFreeToday: content.is_free_today === true,
    pages,
    hasPages: pages.length > 0,
  };
}

/**
 * `pages` у Remanga — массив групп, а группа — массив картинок (развороты и
 * длинные полосы). Порядок важен, поэтому раскрываем вложенность, но не
 * сортируем. Каждую ссылку подписываем на наш прокси.
 */
function normalizePages(value: unknown): MangaPage[] {
  const pages: MangaPage[] = [];

  for (const group of asArray(value)) {
    const items = Array.isArray(group) ? group : [group];
    for (const item of items) {
      const obj = asObject(item);
      const raw = obj ? asText(obj.link) : asText(item);
      if (!raw) continue;

      const url = signMedia(raw);
      if (!url) continue;

      pages.push({
        url,
        width: obj ? asInt(obj.width) : null,
        height: obj ? asInt(obj.height) : null,
      });
    }
  }

  return pages;
}

// ─────────────────────────── Свой индекс ───────────────────────────

export interface MangaIndexRow {
  title_id: number;
  dir: string;
  title: string;
  original_title: string | null;
  alternative_title: string | null;
  kind: string | null;
  status: string | null;
  year: number | null;
  rating: number | null;
  votes: number | null;
  views: number | null;
  chapters_count: number | null;
  cover_url: string | null;
  source_url: string;
  genres?: string[];
  tags?: string[];
  rank?: number | null;
  in_catalog?: boolean;
  updated_at: string;
}

export function mangaIndexRow(
  manga: MangaSummary,
  overrides: { rank?: number | null; inCatalog?: boolean; updatedAt?: string } = {},
): MangaIndexRow {
  return {
    title_id: manga.id,
    dir: manga.dir,
    title: manga.title,
    original_title: manga.originalTitle,
    alternative_title: manga.alternativeTitle,
    kind: manga.kind,
    status: manga.status,
    year: manga.year,
    rating: manga.rating,
    votes: manga.votes,
    views: manga.views,
    chapters_count: manga.chaptersCount,
    cover_url: manga.coverUrl,
    source_url: manga.sourceUrl,
    // Только если источник их прислал: иначе upsert записал бы пустые
    // списки поверх собранных полным обходом.
    ...(manga.genres ? { genres: manga.genres } : {}),
    ...(manga.tags ? { tags: manga.tags } : {}),
    rank: overrides.rank ?? null,
    in_catalog: overrides.inCatalog ?? false,
    updated_at: overrides.updatedAt ?? new Date().toISOString(),
  };
}

export function fromIndexRow(row: Record<string, unknown>): MangaSummary {
  return {
    id: Number(row.title_id),
    dir: String(row.dir ?? ''),
    title: String(row.title ?? 'Без названия'),
    originalTitle: (row.original_title as string | null) ?? null,
    alternativeTitle: (row.alternative_title as string | null) ?? null,
    kind: (row.kind as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    year: row.year == null ? null : Number(row.year),
    rating: row.rating == null ? null : Number(row.rating),
    votes: row.votes == null ? null : Number(row.votes),
    views: row.views == null ? null : Number(row.views),
    chaptersCount: row.chapters_count == null ? null : Number(row.chapters_count),
    coverUrl: (row.cover_url as string | null) ?? null,
    sourceUrl: String(row.source_url ?? ''),
    genres: Array.isArray(row.genres) ? (row.genres as string[]) : [],
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  };
}

/**
 * «Докладывает» найденные тайтлы в индекс, чтобы карточка открылась, даже
 * если их нет в текущей витрине. Существующие строки не трогаем
 * (ignoreDuplicates): крон может хранить более полные данные.
 */
export async function rememberManga(items: MangaSummary[]): Promise<void> {
  if (items.length === 0) return;

  try {
    const supabase = createServiceClient();
    const rows = items.map((item) => mangaIndexRow(item));
    const { error } = await supabase.from('manga_index').upsert(rows, {
      onConflict: 'title_id',
      ignoreDuplicates: true,
    });
    if (error) {
      console.warn('[manga] запомнить метаданные не удалось:', error.message);
    }
  } catch (err) {
    console.warn(
      '[manga] запомнить метаданные не удалось:',
      err instanceof Error ? err.message : err,
    );
  }
}

export interface MangaCatalogParams {
  query?: string;
  kind?: string;
  page?: number;
  pageSize?: number;
}


/** Поиск с опечатками по индексу (search_manga_fuzzy, миграция 0061). */
async function fuzzySearch(
  supabase: ReturnType<typeof createClient>,
  query: string,
  from: number,
  pageSize: number,
) {
  const { data, error } = await supabase.rpc('search_manga_fuzzy', {
    q: query.toLowerCase(),
    lim: pageSize,
    off: from,
  });
  if (error) {
    console.error('[manga] search_manga_fuzzy:', error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => fromIndexRow(r));
}

/**
 * Витрина из своего индекса: быстрый первый экран и поиск по подстроке
 * триграммами. Никогда не бросает — при недоступном Supabase возвращает
 * пусто, и страница откатывается на живой поиск.
 */
export async function getMangaCatalog(
  params: MangaCatalogParams,
): Promise<{ items: MangaSummary[]; total: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, params.pageSize ?? 24));
  const from = (page - 1) * pageSize;

  try {
    const supabase = createClient();
    let q = supabase
      .from('manga_index')
      // estimated, а не exact: после полного обхода в каталоге десятки тысяч
      // строк, и точный count(*) на каждом открытии раздела дорог. Для
      // числа страниц пагинации оценки хватает.
      .select('*', { count: 'estimated' })
      .eq('in_catalog', true);

    const query = (params.query ?? '').trim();
    if (query) {
      // По словам, в любом порядке; служебные символы PostgREST вырезаются
      // (см. lib/indexSearch.ts).
      const filter = wordSearchFilter(query, ['title', 'original_title', 'alternative_title']);
      if (filter) q = q.or(filter);
    }

    if (params.kind) q = q.eq('kind', params.kind);

    const { data, count } = await q
      // Сначала витрина (rank), потом остальной каталог по просмотрам; id —
      // последним ключом, чтобы страницы не повторяли и не теряли записи.
      .order('rank', { ascending: true, nullsFirst: false })
      .order('views', { ascending: false, nullsFirst: false })
      .order('title_id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (query && (data ?? []).length === 0) {
      // Точный поиск по словам пуст — пробуем с опечатками (миграция 0061:
      // «Фриерен» → «Фрирен»). Только запасным путём, чтобы точные
      // совпадения не тонули среди похожих.
      const fuzzy = await fuzzySearch(supabase, query, from, pageSize);
      const items = fuzzy.filter((item) => !params.kind || item.kind === params.kind);
      return { items, total: from + items.length + (fuzzy.length === pageSize ? 1 : 0) };
    }

    return {
      items: (data ?? []).map((r) => fromIndexRow(r as Record<string, unknown>)),
      total: count ?? 0,
    };
  } catch {
    return { items: [], total: 0 };
  }
}

/** Типы в витрине — для чипов над сеткой. */
export async function getMangaKinds(): Promise<{ kind: string; count: number }[]> {
  // Считает база (миграция 0060, manga_kind_counts): раньше код выгружал колонку и
  // считал сам, а PostgREST отдаёт не больше 1000 строк — с полным каталогом
  // чипы показывали бы цифры первой тысячи. Кэш на 6 часов: каталог меняется
  // раз в сутки.
  try {
    // singleFlight: при пустом кэше параллельные заходы ждут один подсчёт.
    return await singleFlight('manga:kinds', 10 * 60 * 1000, () => getCachedJson('manga:kinds', 6 * 60 * 60, async () => {
      const { data, error } = await createServiceClient().rpc('manga_kind_counts');
      if (error) throw new Error(error.message);
      return ((data ?? []) as { kind: string; count: number | string }[])
        .map((row) => ({ kind: row.kind, count: Number(row.count) }))
        .slice(0, 12);
    }));
  } catch {
    return [];
  }
}

/** Запись индекса по слагу — запасной путь, когда живой API недоступен. */
export async function getMangaByDir(dir: string): Promise<MangaSummary | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('manga_index')
      .select('*')
      .eq('dir', dir)
      .maybeSingle();
    return data ? fromIndexRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Запись индекса по id тайтла — для «продолжить чтение» без locator. */
export async function getMangaById(id: number): Promise<MangaSummary | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('manga_index')
      .select('*')
      .eq('title_id', id)
      .maybeSingle();
    return data ? fromIndexRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

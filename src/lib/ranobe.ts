import sanitizeHtml from 'sanitize-html';
import { getCachedJson } from '@/lib/cache/apiCache';
import { singleFlight } from '@/lib/singleFlight';
import { taxonNames } from '@/lib/catalogTaxonomy';
import { decodeHtmlEntities } from '@/lib/sources/text';
import { wordSearchFilter } from '@/lib/indexSearch';
import { signImageUrl } from '@/lib/extract/proxy';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  formatRanobeChapterLabel,
  type RanobeChapter,
  type RanobeChapterContent,
  type RanobeChapterRef,
  type RanobeDetails,
  type RanobeSummary,
} from '@/lib/ranobeShared';

/**
 * Ранобэ с Renovels.
 *
 * Почему API, а не парсинг сайта. У Renovels есть публичный JSON API
 * (`api.renovels.org/api`), который отдаёт и каталог, и поиск, и главы с
 * текстом. HTML-страницы того же сайта — клиентский Next.js: парсить их
 * значило бы ловить хеши чанков и ломаться на каждом редизайне.
 *
 * Что НЕ храним. Текст глав — самый тяжёлый и самый изменчивый кусок: он
 * запрашивается с API в момент открытия главы и сразу санитизируется. В
 * Postgres попадают только id, слаг и лёгкие метаданные витрины (см.
 * миграцию 0055). Описание, жанры и оглавление всегда берутся живьём.
 *
 * Ограничение источника. Платные главы Renovels отдают с `is_paid = true` и
 * пустым `content`. Обойти это нельзя: текст физически не приходит, пока
 * глава не куплена. Мы показываем такие главы в оглавлении заблокированными,
 * но не притворяемся, что умеем их читать.
 */

const API_BASE = 'https://api.renovels.org';
const SITE_BASE = 'https://renovels.org';

const USER_AGENT = 'MediaWatch/1.0 (+ranobe; contact: site admin)';

/** Таймаут одного запроса к Renovels. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Поиск и карточка меняются нечасто; главы — чаще, но не ежесекундно. */
const SEARCH_TTL_SECONDS = 10 * 60;
const TITLE_TTL_SECONDS = 30 * 60;
const CHAPTERS_TTL_SECONDS = 30 * 60;

/**
 * Сколько глав просим за страницу. 500 — проверенный максимум: у тайтлов с
 * 540 главами приходит `next = 2`, и вторая страница добирает остаток.
 */
const CHAPTERS_PER_PAGE = 500;

/** Предохранитель от бесконечной пагинации, если API зациклит `next`. */
const MAX_CHAPTER_PAGES = 30;

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
 * GET JSON с API Renovels. Ошибку/таймаут не бросаем: страница ранобэ должна
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
      console.warn(`[ranobe] ${path}: HTTP ${res.status}`);
      return null;
    }

    return asObject(await res.json());
  } catch (err) {
    console.warn(
      `[ranobe] ${path}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * То же, но для fetcher'а кэша: пустой ответ — это ошибка, а не значение.
 * Иначе временный сбой Renovels закэшировался бы на полчаса (getCachedJson
 * кэширует null/[] так же, как настоящие данные), и раздел оставался бы
 * пустым даже после восстановления источника.
 */
async function apiJsonOrThrow(path: string): Promise<JsonObject> {
  const json = await apiJson(path);
  if (!json) throw new Error(`Renovels не ответил: ${path}`);
  return json;
}

/**
 * Кэш поверх Supabase — тот же, что у книг и подкастов. Нужен, чтобы
 * оглавление не запрашивалось заново при каждом переходе по главам.
 * Если кэш недоступен (локальная разработка без service-ключа) — просто
 * идём в сеть.
 */
async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  // Отличаем «кэш недоступен» от «источник не ответил». Во втором случае
  // fetcher уже бросал ошибку, и повторять его нельзя: это лишние 20 секунд
  // ожидания на каждый провал Renovels. getCachedJson сам ошибок fetcher'а не
  // глотает, поэтому флаг выставляется до вызова.
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

/** Абсолютный адрес на сайте Renovels (картинки и ссылки в тексте глав). */
function absoluteSiteUrl(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${SITE_BASE}${value}`;
  return `${SITE_BASE}/${value}`;
}

/**
 * Адрес обложки. Список (v2) отдаёт её с «/media/titles/…», а карточка (v1,
 * /api/titles/…) — относительным «titles/…» без /media. absoluteSiteUrl
 * склеивал такой путь в renovels.org/titles/… — это 404, и в «Продолжить» и
 * историю уходила битая обложка (24.10.2026). Как в lib/manga.ts: голый путь
 * обложки живёт под /media/. Ссылки в тексте глав так не правим — там
 * относительный путь значит страницу сайта, а не медиа.
 */
function absoluteCoverUrl(raw: string | null): string | null {
  const value = raw?.trim();
  if (value && !value.startsWith('/') && !/^(https?:)?\/\//i.test(value) && !value.startsWith('media/')) {
    return `${SITE_BASE}/media/${value}`;
  }
  return absoluteSiteUrl(value ?? null);
}

/**
 * Подпись обложки через /api/proxy/raw. Без секрета (локальная сборка без
 * .env) отдаём прямой адрес: картинка может не загрузиться, но заглушка из-за
 * отсутствующего секрета — хуже.
 */
function signCover(raw: string | null): string | null {
  const absolute = absoluteCoverUrl(raw);
  if (!absolute) return null;
  try {
    return signImageUrl(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Картинки в тексте главы подписываются в наш прокси, а прокси умеет ходить
 * на произвольный URL. Пускать туда адреса из чужого HTML нельзя: автор
 * главы мог бы подсунуть http://127.0.0.1/… и получить SSRF. Поэтому в
 * санитайзере разрешены только медиа самого Renovels.
 */
function isAllowedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return (
      url.hostname === 'renovels.org' ||
      url.hostname.endsWith('.renovels.org')
    );
  } catch {
    return false;
  }
}

/** Обложка из разных форм ответа: `cover.high`, `img.mid`, строка. */
function coverOf(item: JsonObject): string | null {
  const direct = asText(item.cover);
  if (direct) return signCover(direct);

  for (const container of ['cover', 'img']) {
    const obj = asObject(item[container]);
    if (!obj) continue;
    for (const key of ['high', 'mid', 'low', 'original']) {
      const value = asText(obj[key]);
      if (value) return signCover(value);
    }
  }

  return null;
}

/** `type` у списка — строка, у карточки — объект `{id, name}`. */
function kindOf(item: JsonObject): string | null {
  const direct = asText(item.type);
  if (direct) return direct;
  const obj = asObject(item.type);
  return obj ? asText(obj.name) : null;
}

/** `status` аналогично: строка в списке, объект в карточке. */
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
export function normalizeRanobe(item: unknown): RanobeSummary | null {
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

  return {
    id,
    dir,
    title,
    originalTitle,
    kind: kindOf(obj),
    status: statusOf(obj),
    year: asInt(obj.issue_year),
    rating: asNumber(obj.avg_rating),
    votes: asInt(obj.total_votes),
    views: asInt(obj.total_views),
    chaptersCount: asInt(obj.count_chapters),
    genres: taxonNames(obj.genres),
    // «Категории» у Remanga/Renovels — это теги.
    tags: taxonNames(obj.categories),
    coverUrl: coverOf(obj),
    sourceUrl: `${SITE_BASE}/novel/${encodeURIComponent(dir)}/main`,
  };
}

// ─────────────────────────── Поиск и каталог ───────────────────────────

export interface RanobeSearchResult {
  items: RanobeSummary[];
  total: number;
  hasNext: boolean;
}

/**
 * Живой поиск по подстроке. Renovels ищет по названию (в том числе
 * оригинальному) и сам разбивает выдачу на страницы; `count` максимум 24 у
 * поиска, поэтому фиксируем его.
 */
export async function searchRanobe(query: string, page = 1): Promise<RanobeSearchResult> {
  const q = query.trim();
  if (!q) return { items: [], total: 0, hasNext: false };

  const key = `ranobe:search:${q}:${page}`;
  try {
    return await cachedJson<RanobeSearchResult>(key, SEARCH_TTL_SECONDS, async () => {
      const json = await apiJsonOrThrow(
        `/api/search/?query=${encodeURIComponent(q)}&count=24&page=${page}`,
      );

      const items = asArray(json.content)
        .map(normalizeRanobe)
        .filter((x): x is RanobeSummary => x !== null);

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

export interface RanobeCatalogPage {
  items: RanobeSummary[];
  total: number;
  totalPages: number;
}

/**
 * Одна страница витрины Renovels. Без кэша: это ходит только ночной крон
 * (lib/ranobeIndex.ts), а ему нужны свежие данные.
 *
 * Допустимые сортировки проверены живьём: `-rating`, `-views`, `-id`,
 * `-count_chapters`. Остальные (`-total_views`, `-avg_rating` и т.п.)
 * возвращают пустой ответ — их в списке нет намеренно.
 */
export async function fetchRanobeCatalogPage(options: {
  ordering: string;
  page: number;
  count?: number;
  categories?: number | null;
}): Promise<RanobeCatalogPage> {
  // 30 — потолок каталога Renovels: с 23.10.2026 на count > 30 он отвечает
  // 400 «значение должно быть меньше либо равно 30» (раньше пропускал 50).
  const count = Math.min(30, Math.max(1, options.count ?? 30));
  const params = new URLSearchParams({
    count: String(count),
    page: String(options.page),
    ordering: options.ordering,
  });
  if (options.categories != null) {
    params.set('categories', String(options.categories));
  }

  const json = await apiJson(`/api/search/catalog/?${params.toString()}`);
  if (!json) return { items: [], total: 0, totalPages: 0 };

  const items = asArray(json.content)
    .map(normalizeRanobe)
    .filter((x): x is RanobeSummary => x !== null);

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
export async function getRanobeDetails(dir: string): Promise<RanobeDetails | null> {
  const clean = dir.trim();
  if (!clean) return null;

  const fallback = await getRanobeByDir(clean);

  let json: JsonObject | null = null;
  try {
    json = await cachedJson<JsonObject>(
      `ranobe:title:${clean}`,
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

  const summary = normalizeRanobe(content) ?? fallback;
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

/** `next` в ответе списка глав — номер страницы (иногда строка/URL). */
function nextPageOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  const text = asText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const m = text.match(/[?&]page=(\d+)/);
  return m ? Number(m[1]) : null;
}

function normalizeChapter(value: unknown, fallbackIndex: number): RanobeChapter | null {
  const obj = asObject(value);
  if (!obj) return null;

  const id = asInt(obj.id);
  if (id == null || id <= 0) return null;

  const rawIndex = asInt(obj.index);
  const index = rawIndex != null && rawIndex > 0 ? rawIndex : fallbackIndex;
  const tome = Math.max(1, asInt(obj.tome) ?? 1);
  const number = asText(obj.chapter) ?? '';
  const name = asText(obj.name) ?? '';

  return {
    id,
    index,
    tome,
    number,
    name,
    isPaid: obj.is_paid === true,
    isPublished: obj.is_published !== false,
    label: formatRanobeChapterLabel({ index, tome, number, name }),
  };
}

/**
 * Полное оглавление ветки. Страницы склеиваются, дубли по id отбрасываются.
 * Кэш на полчаса: новые главы у источника выходят не каждую минуту, а
 * читатель дёргает это при каждом переходе.
 */
export async function listRanobeChapters(branchId: number): Promise<RanobeChapter[]> {
  if (!Number.isSafeInteger(branchId) || branchId <= 0) return [];

  return cachedJson<RanobeChapter[]>(
    `ranobe:chapters:${branchId}`,
    CHAPTERS_TTL_SECONDS,
    async () => {
      const byId = new Map<number, RanobeChapter>();
      let page: number | null = 1;

      for (let i = 0; i < MAX_CHAPTER_PAGES && page != null; i++) {
        const json = await apiJsonOrThrow(
          `/api/v2/titles/chapters/?branch_id=${branchId}` +
            `&count=${CHAPTERS_PER_PAGE}&page=${page}&ordering=index`,
        );

        const results = asArray(json.results);
        results.forEach((entry, i) => {
          const chapter = normalizeChapter(entry, byId.size + i + 1);
          if (chapter) byId.set(chapter.id, chapter);
        });

        const next = nextPageOf(json.next);
        page = next != null && next !== page ? next : null;

        if (results.length === 0) break;
        if (page != null) await sleep(120);
      }

      return [...byId.values()].sort((a, b) => a.index - b.index || a.id - b.id);
    },
  ).catch(() => []);
}

function chapterRef(value: unknown): RanobeChapterRef | null {
  const obj = asObject(value);
  if (!obj) return null;
  const id = asInt(obj.id);
  if (id == null || id <= 0) return null;
  return {
    id,
    index: asInt(obj.index) ?? 0,
    tome: Math.max(1, asInt(obj.tome) ?? 1),
    number: asText(obj.chapter) ?? '',
    isPaid: obj.is_paid === true,
  };
}

// ─────────────────────────── Санитайзер главы ───────────────────────────

const ALLOWED_TAGS = [
  'p',
  'div',
  'span',
  'br',
  'hr',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'strike',
  'sub',
  'sup',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'figure',
  'figcaption',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  parseStyleAttributes: false,
  transformTags: {
    // Картинки у Renovels лежат на том же сайте; прогоняем через подписанный
    // прокси, чтобы браузер не ходил на чужой домен и не ждал тяжёлый оригинал.
    img: (_tagName, attribs): sanitizeHtml.Tag => {
      const src = absoluteSiteUrl(attribs.src ?? null);
      if (!src || !isAllowedMediaUrl(src)) {
        return { tagName: 'span', attribs: {} };
      }

      const out: sanitizeHtml.Attributes = {
        src: signCover(src) ?? src,
        alt: attribs.alt ?? '',
        loading: 'lazy',
      };
      if (/^\d+$/.test(attribs.width ?? '')) out.width = attribs.width;
      if (/^\d+$/.test(attribs.height ?? '')) out.height = attribs.height;

      return { tagName: 'img', attribs: out };
    },
    // Ссылки оставляем только http(s)/mailto и всегда открываем в новой
    // вкладке: внутри главы это сноски и ссылки на источник, не навигация.
    a: (_tagName, attribs): sanitizeHtml.Tag => {
      const href = attribs.href?.trim();
      if (!href) return { tagName: 'span', attribs: {} };
      // mailto: — не адрес сайта, absoluteSiteUrl сделал бы из него
      // https://renovels.org/mailto:…, поэтому проверяем раньше.
      if (/^mailto:/i.test(href)) {
        return {
          tagName: 'a',
          attribs: { href, rel: 'noopener noreferrer nofollow' },
        };
      }
      const absolute = absoluteSiteUrl(href);
      if (!absolute || !/^https?:/i.test(absolute)) {
        return { tagName: 'span', attribs: {} };
      }
      return {
        tagName: 'a',
        attribs: {
          href: absolute,
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      };
    },
  },
};

/** Чистит HTML главы перед dangerouslySetInnerHTML. */
export function sanitizeRanobeHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Текст одной главы. Не кэшируется в базе: это как раз тот «тяжёлый» контент,
 * который решено не хранить. Зато в памяти процесса он живёт недолго — его
 * забирает серверный рендер страницы.
 */
export async function getRanobeChapterById(
  chapterId: number,
): Promise<RanobeChapterContent | null> {
  if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return null;

  const json = await apiJson(`/api/v2/titles/chapters/${chapterId}/`);
  if (!json) return null;

  const rawHtml = asText(json.content) ?? '';
  const isPaid = json.is_paid === true;
  const hasContent = rawHtml.trim().length > 0;

  return {
    id: asInt(json.id) ?? chapterId,
    titleId: asInt(json.title_id) ?? 0,
    index: asInt(json.index) ?? 0,
    tome: Math.max(1, asInt(json.tome) ?? 1),
    number: asText(json.chapter) ?? '',
    name: asText(json.name) ?? '',
    isPaid,
    html: hasContent ? sanitizeRanobeHtml(rawHtml) : '',
    hasContent,
    previous: chapterRef(json.previous),
    next: chapterRef(json.next),
  };
}

// ─────────────────────────── Свой индекс ───────────────────────────

export interface RanobeIndexRow {
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

export function ranobeIndexRow(
  ranobe: RanobeSummary,
  overrides: { rank?: number | null; inCatalog?: boolean; updatedAt?: string } = {},
): RanobeIndexRow {
  // alternative_title в карточке есть, но в типе RanobeSummary мы его не
  // держим: для поиска достаточно originalTitle. Отдельная колонка нужна,
  // чтобы индексировать third name у источника; сюда попадает то же значение.
  return {
    title_id: ranobe.id,
    dir: ranobe.dir,
    title: ranobe.title,
    original_title: ranobe.originalTitle,
    alternative_title: null,
    kind: ranobe.kind,
    status: ranobe.status,
    year: ranobe.year,
    rating: ranobe.rating,
    votes: ranobe.votes,
    views: ranobe.views,
    chapters_count: ranobe.chaptersCount,
    cover_url: ranobe.coverUrl,
    source_url: ranobe.sourceUrl,
    // Только если источник их прислал: иначе upsert записал бы пустые
    // списки поверх собранных полным обходом.
    ...(ranobe.genres ? { genres: ranobe.genres } : {}),
    ...(ranobe.tags ? { tags: ranobe.tags } : {}),
    rank: overrides.rank ?? null,
    in_catalog: overrides.inCatalog ?? false,
    updated_at: overrides.updatedAt ?? new Date().toISOString(),
  };
}

export function fromIndexRow(row: Record<string, unknown>): RanobeSummary {
  return {
    id: Number(row.title_id),
    dir: String(row.dir ?? ''),
    title: String(row.title ?? 'Без названия'),
    originalTitle: (row.original_title as string | null) ?? null,
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
export async function rememberRanobe(items: RanobeSummary[]): Promise<void> {
  if (items.length === 0) return;

  try {
    const supabase = createServiceClient();
    const rows = items.map((item) => ranobeIndexRow(item));
    const { error } = await supabase.from('ranobe_index').upsert(rows, {
      onConflict: 'title_id',
      ignoreDuplicates: true,
    });
    if (error) {
      console.warn('[ranobe] запомнить метаданные не удалось:', error.message);
    }
  } catch (err) {
    console.warn(
      '[ranobe] запомнить метаданные не удалось:',
      err instanceof Error ? err.message : err,
    );
  }
}

export interface RanobeCatalogParams {
  query?: string;
  kind?: string;
  page?: number;
  pageSize?: number;
}


/** Поиск с опечатками по индексу (search_ranobe_fuzzy, миграция 0061). */
async function fuzzySearch(
  supabase: ReturnType<typeof createClient>,
  query: string,
  from: number,
  pageSize: number,
) {
  const { data, error } = await supabase.rpc('search_ranobe_fuzzy', {
    q: query.toLowerCase(),
    lim: pageSize,
    off: from,
  });
  if (error) {
    console.error('[ranobe] search_ranobe_fuzzy:', error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => fromIndexRow(r));
}

/**
 * Витрина из своего индекса: быстрый первый экран и поиск по подстроке
 * триграммами. Никогда не бросает — при недоступном Supabase возвращает
 * пусто, и страница откатывается на живой поиск.
 */
export async function getRanobeCatalog(
  params: RanobeCatalogParams,
): Promise<{ items: RanobeSummary[]; total: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, params.pageSize ?? 24));
  const from = (page - 1) * pageSize;

  try {
    const supabase = createClient();
    let q = supabase
      .from('ranobe_index')
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

/** Типы (происхождение) в витрине — для чипов над сеткой. */
export async function getRanobeKinds(): Promise<{ kind: string; count: number }[]> {
  // Считает база (миграция 0060, ranobe_kind_counts): раньше код выгружал колонку и
  // считал сам, а PostgREST отдаёт не больше 1000 строк — с полным каталогом
  // чипы показывали бы цифры первой тысячи. Кэш на 6 часов: каталог меняется
  // раз в сутки.
  try {
    // singleFlight: при пустом кэше параллельные заходы ждут один подсчёт.
    return await singleFlight('ranobe:kinds', 10 * 60 * 1000, () => getCachedJson('ranobe:kinds', 6 * 60 * 60, async () => {
      const { data, error } = await createServiceClient().rpc('ranobe_kind_counts');
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
export async function getRanobeByDir(dir: string): Promise<RanobeSummary | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('ranobe_index')
      .select('*')
      .eq('dir', dir)
      .maybeSingle();
    return data ? fromIndexRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Запись индекса по id тайтла — для «продолжить чтение» без locator. */
export async function getRanobeById(id: number): Promise<RanobeSummary | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('ranobe_index')
      .select('*')
      .eq('title_id', id)
      .maybeSingle();
    return data ? fromIndexRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

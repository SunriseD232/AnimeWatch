import { getCachedJson } from '@/lib/cache/apiCache';
import { singleFlight } from '@/lib/singleFlight';
import { wordSearchFilter } from '@/lib/indexSearch';
import { signImageUrl, signRawUrl } from '@/lib/extract/proxy';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { XMLParser } from 'fast-xml-parser';
import { XML_ENTITY_OPTIONS } from '@/lib/xmlLimits';
import { vlessDispatcher } from '@/lib/net/vlessProxy';
import { readStoredBookFile } from '@/lib/bookDisk';
import { cachedBookFormats, readCachedBookFile, writeCachedBookFile } from '@/lib/bookCache';
import { fetchCoollibFile, findCoollibBook } from '@/lib/sources/coollib';
import {
  DEFAULT_BOOK_FORMAT,
  type BookChapter,
  type BookDetails,
  type BookFormat,
  type BookSummary,
} from '@/lib/bookShared';

/**
 * Книги с Флибусты через OPDS.
 *
 * Почему OPDS, а не парсинг сайта. Флибуста отдаёт каталог в формате Atom
 * (`/opds`), и это машиночитаемый контракт, который меняется редко. Парсинг
 * HTML-страниц сломался бы на первом же редизайне, а OPDS — по сути чужой
 * API. Тот же приём уже используется для iTunes и RSS у подкастов.
 *
 * Почему Флибуста. По решению проекта — «всё, даже платное»: у Флибусты
 * лежат и новинки, и то, что продаётся в магазинах. Сайт закрыт приглашениями,
 * файлы у себя не храним, отдаём через прокси по запросу — тот же класс
 * риска, что уже есть у пиратских видеобалансеров (см. план, раздел 7).
 *
 * Два зеркала и переключение. `flibusta.is` и `flibusta.site` — независимые
 * зеркала одного каталога; когда одно лежит, второе обычно живо. Держим
 * список и пробуем по очереди, а не захардкоженный один хост: у Флибусты
 * бывают плановые переезды, и один хост — единственная точка отказа.
 *
 * Файлы книги маленькие (0,3–1,5 МБ), но качаем их всё равно через наш
 * прокси с подписанной ссылкой: источник http, у нас https (mixed content),
 * плюс так адрес Флибусты наружу не уходит.
 */

// ─────────────────────────── Зеркала и константы ───────────────────────────

/**
 * Зеркала в порядке предпочтения. Проверены живьём 23.10.2026: оба отдают
 * OPDS 200. `flibusta.appspot.com` мёртв, `flibusta.net` — битый TLS, их в
 * списке нет намеренно.
 */
const MIRRORS = ['https://flibusta.is', 'https://flibusta.site'] as const;

/**
 * User-Agent с названием приложения. Флибуста не требует его официально, но
 * это вежливо и помогает, если у хоста появится защита от «безымянных» ботов.
 */
const USER_AGENT = 'MediaWatch/1.0 (+books; contact: site admin)';

/** Сколько живёт кэш выдачи OPDS. Книги почти не меняются, а новинки — да. */
const SEARCH_TTL_SECONDS = 60 * 60;

// ─────────────────────────── Разбор Atom/OPDS ───────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Значения тегов оставляем строками: иначе «1804 Kb» или «1995» в описании
  // превратились бы в число и потеряли формат, а числа мы разбираем сами.
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'entry' || name === 'link' || name === 'category',
  // Лимит раскрытий сущностей поднят — см. lib/xmlLimits.ts.
  processEntities: XML_ENTITY_OPTIONS,
});

type XmlNode = Record<string, unknown>;

/** Текст узла: строка, число или `#text` внутри атрибутного объекта. */
function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && !Array.isArray(value)) {
    const t = (value as XmlNode)['#text'];
    if (typeof t === 'string') return t.trim() || null;
    if (typeof t === 'number') return String(t);
  }
  return null;
}

/** Атрибут узла. */
function attr(value: unknown, name: string): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = (value as XmlNode)[name];
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function nodes(value: unknown): XmlNode[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is XmlNode => typeof v === 'object' && v !== null);
  }
  if (value && typeof value === 'object') return [value as XmlNode];
  return [];
}

/** Разворачивает HTML-сущности и убирает теги (OPDS кладёт аннотацию в HTML). */
function stripTags(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

// ─────────────────────────── Нормализация записи ───────────────────────────

/** Размер из описания Флибусты («Размер: 1804 Kb» / «Размер: 6792 B»). */
function parseSize(description: string | null): number | null {
  if (!description) return null;
  const m = description.match(/Размер:\s*([\d\s.,]+)\s*(B|Kb|KB|K|Mb|MB|M)?/i);
  if (!m) return null;
  const num = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] ?? 'B').toUpperCase();
  if (unit.startsWith('K')) return Math.round(num * 1024);
  if (unit.startsWith('M')) return Math.round(num * 1024 * 1024);
  return Math.round(num);
}

/** Число скачиваний из описания Флибусты («Скачиваний: 193»). */
function parseDownloads(description: string | null): number | null {
  if (!description) return null;
  const m = description.match(/Скачиваний:\s*([\d\s]+)/i);
  if (!m) return null;
  const num = Number(m[1].replace(/\s/g, ''));
  return Number.isFinite(num) ? num : null;
}

/** Год: у Флибусты это `<dc:issued>`, иногда есть в тексте описания. */
function parseYear(entry: XmlNode, description: string | null): number | null {
  const issued = asText(entry['dc:issued']);
  const fromTag = issued ? Number(issued.slice(0, 4)) : NaN;
  if (Number.isFinite(fromTag) && fromTag > 1000 && fromTag < 2100) return fromTag;

  if (description) {
    const m = description.match(/Год издания:\s*(\d{4})/);
    if (m) {
      const y = Number(m[1]);
      if (Number.isFinite(y)) return y;
    }
  }
  return null;
}

/**
 * Аннотация из <content>. Флибуста кладёт туда HTML-описание книги, а в
 * конце — служебный хвост «Год издания: … Формат: … Язык: … Размер: …
 * Скачиваний: …». Хвост отрезаем: он повторяет поля, а в карточке выглядит
 * мусором.
 */
function parseAnnotation(content: string | null): string | null {
  if (!content) return null;
  const clean = stripTags(content);
  if (!clean) return null;
  const cut = clean.search(/\n?\s*(Год издания|Формат|Язык|Размер|Скачиваний):/i);
  const body = (cut > 0 ? clean.slice(0, cut) : clean).trim();
  // Совсем короткие обрывки («Формат: fb2») аннотацией не считаем.
  return body.length >= 20 ? body : null;
}

/**
 * Форматы из ссылок-приобретений. Нас интересуют только epub и fb2: EPUB
 * читает epub.js, FB2 — серверный парсер. Остальные (html/txt/mobi/rtf)
 * игнорируем: они либо дублируют epub, либо нечитаемы в браузере.
 */
function parseFormats(entry: XmlNode): BookFormat[] {
  const found = new Set<BookFormat>();
  for (const link of nodes(entry.link)) {
    const href = attr(link, '@_href') ?? '';
    if (href.endsWith('/epub')) found.add('epub');
    else if (href.endsWith('/fb2')) found.add('fb2');
  }
  // epub Флибуста умеет конвертировать почти из любой fb2-книги, поэтому
  // epub считаем доступным всегда, когда есть fb2. Это не выдумка: конвертер
  // работает на лету (проверено — /b/6341/epub отдаёт 200 для fb2-книги).
  if (found.has('fb2')) found.add('epub');
  return [...found];
}

/** Авторы: все <author><name>. */
function parseAuthors(entry: XmlNode): string {
  const authors = nodes(entry.author)
    .map((a) => asText(a.name))
    .filter((s): s is string => Boolean(s));
  return authors.join(', ') || 'Автор неизвестен';
}

/** Жанры: все <category label=…>. */
function parseGenres(entry: XmlNode): string[] {
  const seen = new Set<string>();
  for (const c of nodes(entry.category)) {
    const genre = attr(c, '@_label') ?? attr(c, '@_term');
    if (genre) seen.add(genre);
  }
  return [...seen];
}

/** Обложка: `<link rel="http://opds-spec.org/image">`. Есть не у всех книг. */
function parseCover(entry: XmlNode, base: string): string | null {
  for (const link of nodes(entry.link)) {
    const rel = attr(link, '@_rel') ?? '';
    if (rel === 'http://opds-spec.org/image' || rel === 'http://opds-spec.org/thumbnail') {
      const href = attr(link, '@_href');
      if (href) return href.startsWith('http') ? href : `${base}${href}`;
    }
  }
  return null;
}

/**
 * Подписанная ссылка на обложку через наш прокси. Обложки Флибусты — PNG по
 * 300–700 КБ (проверено живьём), а в сетке из 24 карточек это десятки
 * мегабайт. /api/proxy/raw умеет ресайзить по `?w=` (см. proxy/raw/route.ts),
 * поэтому карточка дописывает размер, а сюда попадает уже стабильная
 * подписанная ссылка (TTL как у постеров — 100 лет, см. signImageUrl).
 *
 * Если секрет не задан (локальная сборка без .env), подпись невозможна —
 * отдаём прямой адрес, пусть браузер попробует сам. Показать заглушку из-за
 * отсутствующего секрета хуже, чем возможную битую картинку.
 */
function signCover(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return signImageUrl(raw);
  } catch {
    return raw;
  }
}

/** Ссылка на страницу книги: `<link rel="alternate">`, иначе собираем сами. */
function parseSourceUrl(entry: XmlNode, id: number, base: string): string {
  for (const link of nodes(entry.link)) {
    if (attr(link, '@_rel') === 'alternate') {
      const href = attr(link, '@_href');
      if (href) return href.startsWith('http') ? href : `${base}${href}`;
    }
  }
  return `${base}/b/${id}`;
}

/**
 * id книги из ссылки вида `/b/6341/epub`. Число берём именно оттуда, а не из
 * `<id>tag:book:hash</id>`: по нему же строится скачивание, и он одинаков у
 * всех зеркал.
 */
function parseBookId(entry: XmlNode): number | null {
  for (const link of nodes(entry.link)) {
    const href = attr(link, '@_href') ?? '';
    const m = href.match(/^\/b\/(\d+)(?:\/|$)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Название и автор.
 *
 * В OPDS-ПОИСКЕ Флибуста кладёт авторов прямо в title («Аркадий Стругацкий,
 * Борис Стругацкий - Понедельник начинается в субботу»), а в <author> —
 * оформителя/переводчика. В лентах (/opds/new, жанры) title чистый, а автор
 * в <author> настоящий. Различить просто: если в title есть « - », режем по
 * нему; иначе берём <author>.
 */
function parseTitleAndAuthor(entry: XmlNode): { title: string; author: string } {
  const raw = asText(entry.title) ?? 'Без названия';
  const dash = raw.indexOf(' - ');
  if (dash > 0) {
    return { title: raw.slice(dash + 3).trim(), author: raw.slice(0, dash).trim() };
  }
  return { title: raw, author: parseAuthors(entry) };
}

function toSummary(entry: XmlNode, base: string): BookSummary | null {
  const id = parseBookId(entry);
  if (!id) return null;

  const { title, author } = parseTitleAndAuthor(entry);
  const description = stripTags(asText(entry.content));
  const formats = parseFormats(entry);

  return {
    id,
    title,
    author,
    annotation: parseAnnotation(asText(entry.content)),
    genres: parseGenres(entry),
    // Если Флибуста не перечислила ни epub, ни fb2 (у неё бывают только
    // html/txt/mobi), всё равно считаем epub доступным: конвертер работает на
    // лету из большинства форматов, а без этого книга выпала бы из каталога
    // как «нечитаемая». Реальную ошибку покажет сам читатель.
    formats: formats.length > 0 ? formats : ['epub'],
    language: asText(entry['dc:language']),
    sizeBytes: parseSize(description),
    downloads: parseDownloads(description),
    year: parseYear(entry, description),
    sourceUrl: parseSourceUrl(entry, id, base),
    coverUrl: signCover(parseCover(entry, base)),
  };
}

// ─────────────────────────── Запросы к OPDS ───────────────────────────

/**
 * fetch с перебором зеркал. Пробуем хосты по очереди и останавливаемся на
 * первом успешном. Возвращаем также базу, с которой получилось — относительные
 * ссылки записи надо склеивать именно с ней.
 */
async function fetchFromMirrors(
  path: string,
  init?: RequestInit,
): Promise<{ res: Response; base: string } | null> {
  // Два прохода по зеркалам с паузой: 23.10.2026 flibusta.site отдавал один
  // и тот же OPDS-адрес то 200, то 404 вперемешку (10 запросов подряд к
  // /opds/genres — два 404), и одиночный промах ронял бы ночную пересборку
  // витрины. Когда у Флибусты лежит бэкенд целиком (стабильные 502/503),
  // второй проход только добавляет секунду — ответа всё равно нет.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    const hit = await tryMirrorsOnce(path, init);
    if (hit) return hit;
  }
  return null;
}

async function tryMirrorsOnce(
  path: string,
  init?: RequestInit,
): Promise<{ res: Response; base: string } | null> {
  for (const base of MIRRORS) {
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...(init?.headers ?? {}) },
        // 15 сек: через туннель зеркало отвечает за ~0,3 с. Худший случай —
        // 2 прохода × 2 зеркала = 60 сек, это укладывается в 90 сек
        // proxy_read_timeout nginx с запасом на передачу файла.
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
        // Только через VLESS-туннель (см. lib/net/vlessProxy.ts): с
        // продакшен-VPS оба зеркала напрямую недоступны — блокировка по IP,
        // TCP не устанавливается вовсе (проверено с VPS 23.10.2026). Через
        // туннель flibusta.site отвечает 200 за ~0,3 с.
        // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
        dispatcher: vlessDispatcher(),
      });
      if (res.ok) return { res, base };
      // Тело отказа дочитываем, чтобы соединение через туннель вернулось в
      // пул, а не висело до таймаута.
      await res.arrayBuffer().catch(() => {});
    } catch (err) {
      console.error(
        `[books] зеркало ${base} не ответило:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

/** Разбор Atom-фида в записи. */
function parseFeed(xml: string, base: string): BookSummary[] {
  const doc = xmlParser.parse(xml) as XmlNode;
  const feed = doc.feed as XmlNode | undefined;
  if (!feed) return [];
  return nodes(feed.entry)
    .map((e) => toSummary(e, base))
    .filter((s): s is BookSummary => s !== null);
}

/** Ссылка на следующую страницу OPDS-ленты (rel="next"), если есть. */
function parseNextHref(xml: string): string | null {
  const doc = xmlParser.parse(xml) as XmlNode;
  const feed = doc.feed as XmlNode | undefined;
  if (!feed) return null;
  for (const link of nodes(feed.link)) {
    if (attr(link, '@_rel') === 'next') return attr(link, '@_href');
  }
  return null;
}

export interface BookSearchResult {
  items: BookSummary[];
  /** Есть ли следующая страница (OPDS отдал rel="next"). */
  hasNext: boolean;
}

/**
 * Поиск книг. `page` — 0-основанный в OPDS-поиске Флибусты (проверено живьём),
 * поэтому наружу отдаём 1-основанную, а внутрь вычитаем единицу.
 *
 * Если query пуст — отдаём новинки (`/opds/new/{page}/new`): страница
 * каталога без запроса показывает именно их, и это честнее пустого экрана.
 */
export async function searchBooks(query: string, page = 1): Promise<BookSearchResult> {
  const q = query.trim();
  const key = `books:search:${q}:${page}`;

  return getCachedJson<BookSearchResult>(key, SEARCH_TTL_SECONDS, async () => {
    const path = q
      ? `/opds/search?searchType=books&searchTerm=${encodeURIComponent(q)}&pageNumber=${page - 1}`
      : `/opds/new/${page - 1}/new`;

    const hit = await fetchFromMirrors(path, { headers: { Accept: 'application/atom+xml' } });
    if (!hit) return { items: [], hasNext: false };

    const xml = await hit.res.text();
    return {
      items: parseFeed(xml, hit.base),
      hasNext: parseNextHref(xml) !== null,
    };
  });
}

/**
 * Лента книг по жанру. `genrePath` — то, что вернул listGenres: например
 * `/opds/genres/Фантастика/268`. `page` — 1-основанный, в OPDS добавляется
 * как /{page-1}.
 */
export async function listBooksByGenre(
  genrePath: string,
  page = 1,
): Promise<BookSearchResult> {
  const key = `books:genre:${genrePath}:${page}`;
  return getCachedJson<BookSearchResult>(key, SEARCH_TTL_SECONDS, async () => {
    const path = page > 1 ? `${genrePath}/${page - 1}` : genrePath;
    const hit = await fetchFromMirrors(path, { headers: { Accept: 'application/atom+xml' } });
    if (!hit) return { items: [], hasNext: false };
    const xml = await hit.res.text();
    return { items: parseFeed(xml, hit.base), hasNext: parseNextHref(xml) !== null };
  });
}

// ─────────────────────── Сырые страницы OPDS (для индексатора) ───────────────────────

export interface OpdsPage {
  items: BookSummary[];
  /** href следующей страницы (rel="next"), если она есть. */
  nextHref: string | null;
}

/**
 * Одна страница OPDS без кэша. Нужна индексатору (lib/bookIndex.ts): он
 * обходит десятки лент подряд, и класть их все в api_response_cache было бы
 * бессмысленно — крон и так ходит раз в сутки. Обычные страницы каталога
 * пользуются кэширующими searchBooks/listBooksByGenre.
 */
export async function fetchOpdsPage(path: string): Promise<OpdsPage | null> {
  const hit = await fetchFromMirrors(path, { headers: { Accept: 'application/atom+xml' } });
  if (!hit) return null;
  const xml = await hit.res.text();
  return { items: parseFeed(xml, hit.base), nextHref: parseNextHref(xml) };
}

export interface BookGenreLink {
  title: string;
  /** Путь вида `/opds/genres/Фантастика/268` — его и просит индексатор. */
  path: string;
}

/**
 * Разбор ленты-справочника: `/opds/genres` (жанры) и `/opds/genres/{жанр}`
 * (поджанры). У записей этих лент нет `rel`, только href — поэтому берём
 * первую ссылку, ведущую внутрь OPDS.
 */
async function fetchCatalogLinks(path: string): Promise<BookGenreLink[]> {
  const hit = await fetchFromMirrors(path, { headers: { Accept: 'application/atom+xml' } });
  if (!hit) return [];
  const xml = await hit.res.text();
  const doc = xmlParser.parse(xml) as XmlNode;
  const feed = doc.feed as XmlNode | undefined;
  if (!feed) return [];

  const links: BookGenreLink[] = [];
  for (const entry of nodes(feed.entry)) {
    const title = asText(entry.title);
    const href = nodes(entry.link)
      .map((l) => attr(l, '@_href'))
      .find((h): h is string => Boolean(h && h.startsWith('/opds/')));
    if (title && href) links.push({ title, path: href });
  }
  return links;
}

/** Верхний уровень жанров: `/opds/genres`. */
export function listGenres(): Promise<BookGenreLink[]> {
  return fetchCatalogLinks('/opds/genres');
}

/** Поджанры одного жанра: `/opds/genres/{жанр}`. */
export function listSubgenres(genrePath: string): Promise<BookGenreLink[]> {
  return fetchCatalogLinks(genrePath);
}

// ─────────────────────────── Индекс книг ───────────────────────────

interface BookIndexRow {
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
}

function toIndexRow(book: BookSummary): BookIndexRow {
  return {
    book_id: book.id,
    title: book.title,
    author: book.author || null,
    annotation: book.annotation,
    genres: book.genres,
    language: book.language,
    formats: book.formats,
    size_bytes: book.sizeBytes,
    downloads: book.downloads,
    year: book.year,
    cover_url: book.coverUrl,
    source_url: book.sourceUrl,
  };
}

export function fromIndexRow(row: Record<string, unknown>): BookSummary {
  return {
    id: Number(row.book_id),
    title: String(row.title ?? 'Без названия'),
    author: String(row.author ?? 'Автор неизвестен'),
    annotation: (row.annotation as string | null) ?? null,
    genres: (row.genres as string[] | null) ?? [],
    formats: ((row.formats as string[] | null) ?? []) as BookFormat[],
    language: (row.language as string | null) ?? null,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    downloads: row.downloads == null ? null : Number(row.downloads),
    year: row.year == null ? null : Number(row.year),
    sourceUrl: String(row.source_url ?? ''),
    coverUrl: (row.cover_url as string | null) ?? null,
    offline: Array.isArray(row.local_formats) && row.local_formats.length > 0,
  };
}

/**
 * «Докладывает» метаданные книг в индекс, чтобы карточка открылась по id.
 *
 * Зачем. У Флибусты нет эндпоинта «книга по id», и без записи в book_index
 * страница /books/[id] не знала бы ни названия, ни автора. Каждый показ
 * выдачи поиска пишет сюда то, что уже пришло из OPDS, — бесплатно (данные
 * на руках). Ошибку записи глотаем: если Supabase недоступен, выдача всё
 * равно должна показаться, просто карточка по ссылке откроется не сразу.
 *
 * Пишем сервисным клиентом (см. ниже), а существующие строки не трогаем:
 * upsert с ignoreDuplicates докладывает только новые id. Политик записи для
 * пользовательского токена в book_index нет вовсе (миграция 0054), так что
 * подменить витрину или чужие метаданные через Supabase нельзя.
 */
export async function rememberBooks(books: BookSummary[]): Promise<void> {
  if (books.length === 0) return;
  try {
    // Сервисный клиент, а не пользовательский: страницу каталога видят и
    // анонимные гости (сайт за приглашениями, но каталог — публичный), а
    // политик записи в book_index для пользовательского токена нет вовсе
    // (миграция 0054). Данные сюда приходят из OPDS на сервере, а не от
    // пользователя, так что обхода прав тут нет.
    const supabase = createServiceClient();
    const rows = books.map(toIndexRow);
    const { error } = await supabase.from('book_index').upsert(rows, {
      onConflict: 'book_id',
      // Существующие строки не трогаем: у книг витрины метаданные полнее
      // (крон их обновляет), а перезапись из выдачи поиска могла бы стереть
      // аннотацию или обложку. Нужна именно «докладка» новых id.
      ignoreDuplicates: true,
    });
    if (error) {
      console.warn('[books] запомнить метаданные не удалось:', error.message);
    }
  } catch (err) {
    console.warn(
      '[books] запомнить метаданные не удалось:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Книга по id из индекса. Возвращает null, если её там нет — тогда страница
 * честно скажет «не найдена» (например, по угаданной ссылке).
 *
 * Оглавление здесь пустое: EPUB разбирает epub.js на клиенте, дублировать
 * разбор на сервере незачем (файл всё равно качается в браузер).
 */
export async function getBookById(id: number): Promise<BookDetails | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('book_index')
    .select('*')
    .eq('book_id', id)
    .maybeSingle();

  if (!data) return null;

  const summary = fromIndexRow(data);
  const chapters: BookChapter[] = [];
  return { ...summary, chapters, chaptersUnavailable: false };
}

export interface BookCatalogParams {
  query?: string;
  genre?: string;
  page?: number;
  pageSize?: number;
}


/** Поиск с опечатками по индексу (search_book_fuzzy, миграция 0061). */
async function fuzzySearch(
  supabase: ReturnType<typeof createClient>,
  query: string,
  from: number,
  pageSize: number,
) {
  const { data, error } = await supabase.rpc('search_book_fuzzy', {
    q: query.toLowerCase(),
    lim: pageSize,
    off: from,
  });
  if (error) {
    console.error('[book] search_book_fuzzy:', error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => fromIndexRow(r));
}

/**
 * Витрина каталога: книги, найденные кроном (`in_catalog = true`), плюс
 * поиск по ним триграммами. Никогда не бросает: нет таблицы/упал Supabase —
 * возвращаем пусто, и страница откатывается на живой OPDS-поиск.
 */
export async function getBookCatalog(
  params: BookCatalogParams,
): Promise<{ items: BookSummary[]; total: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, params.pageSize ?? 24));
  const from = (page - 1) * pageSize;

  try {
    const supabase = createClient();
    let q = supabase
      .from('book_index')
      // planned — оценка планировщика, без счёта строк. estimated при
      // фильтре жанра всё равно считал точно: 0,6 с на каждую страницу жанра
      // при 620 тыс. книг. Для числа страниц пагинации оценки хватает.
      .select('*', { count: 'planned' })
      .eq('in_catalog', true);

    const query = (params.query ?? '').trim();
    if (query) {
      // По словам, в любом порядке; служебные символы PostgREST вырезаются
      // (см. lib/indexSearch.ts).
      const filter = wordSearchFilter(query, ['title', 'author']);
      if (filter) q = q.or(filter);
    }

    if (params.genre) {
      q = q.contains('genres', [params.genre]);
    }

    // Витрина OPDS (rank), затем книги из дампа: популярные по скачиваниям,
    // свежие по id. id — последним ключом для стабильной пагинации.
    const { data, count } = await q
      .order('rank', { ascending: true, nullsFirst: false })
      .order('downloads', { ascending: false, nullsFirst: false })
      .order('book_id', { ascending: false })
      .range(from, from + pageSize - 1);

    if (query && (data ?? []).length === 0) {
      // Точный поиск по словам пуст — пробуем с опечатками (миграция 0061:
      // «Фриерен» → «Фрирен»). Только запасным путём, чтобы точные
      // совпадения не тонули среди похожих.
      const fuzzy = await fuzzySearch(supabase, query, from, pageSize);
      const items = fuzzy.filter((book) => !params.genre || book.genres.includes(params.genre));
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

/** Жанры, которые реально есть в витрине, — для фильтра. */
export async function getBookGenres(): Promise<string[]> {
  // Считает база (миграция 0060, book_genre_counts): после импорта дампа
  // Флибусты книг сотни тысяч, а PostgREST отдаёт не больше 1000 строк — код
  // раньше считал жанры по первой тысяче. Кэш на 6 часов.
  try {
    // singleFlight: при пустом кэше параллельные заходы ждут один подсчёт.
    return await singleFlight('books:genres', 10 * 60 * 1000, () => getCachedJson('books:genres', 6 * 60 * 60, async () => {
      const { data, error } = await createServiceClient().rpc('book_genre_counts', { lim: 40 });
      if (error) throw new Error(error.message);
      return ((data ?? []) as { genre: string }[]).map((row) => row.genre);
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────── Файл книги ───────────────────────────

/**
 * Ссылка на файл книги, пропущенная через наш прокси.
 *
 * Возвращает относительный путь `/api/proxy/raw?u=…&s=…` с HMAC-подписью.
 * Прокси решает три вещи сразу: mixed content (источник http), скрытие
 * адреса Флибусты и возможные Referer-ограничения. TTL подписи — как у
 * остальных raw-ссылок (6 часов), файл читается один раз.
 */
export function bookFileUrl(id: number, format: BookFormat = DEFAULT_BOOK_FORMAT): string {
  return signRawUrl(bookFileSourceUrl(id, format), {});
}

/** Прямой адрес файла у Флибусты (для прокси и для диагностики). */
export function bookFileSourceUrl(id: number, format: BookFormat = DEFAULT_BOOK_FORMAT): string {
  return `${MIRRORS[0]}/b/${id}/${format}`;
}

/** Абсолютная ссылка на страницу книги у источника. */
export function bookPageUrl(id: number): string {
  return `${MIRRORS[0]}/b/${id}`;
}

/** Откуда пришёл файл книги — для честных подписей и логов. */
export type BookFileSource = 'saved' | 'cache' | 'flibusta' | 'coollib';

/** Не файл книги (HTML-заглушка «нет книги» с кодом 200 и т. п.). */
function looksLikeBook(body: ArrayBuffer, format: BookFormat): boolean {
  const bytes = new Uint8Array(body);
  const isZip =
    bytes.length > 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7);
  const isXml = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().startsWith('<');
  return format === 'epub' ? isZip : isZip || isXml;
}

// ─────────────────────────── Доступность Флибусты ───────────────────────────

/** Сколько помнить ответ проверки: чаще раза в минуту Флибуста не оживает. */
const PROBE_TTL_MS = 60_000;
let probe: { at: number; up: boolean } | null = null;
let probing: Promise<boolean> | null = null;

/**
 * Маленькие устойчивые книги (Пушкин, 6–10 КБ) — ими проверяем, что
 * Флибуста отдаёт файлы. Проверять каталог (/opds) нельзя: 24.10.2026 он
 * отвечал за 0,3 с, а файлы книг не отдавались вовсе (15 с и обрыв), и
 * проверка по каталогу говорила «работает» — крон запаса и карточки ждали
 * минуту таймаутов на каждой книге.
 */
const PROBE_BOOKS = [218955, 169125];

/**
 * Отдаёт ли Флибуста файлы книг — короткая проверка на обоих зеркалах сразу
 * (8 с), ответ помним минуту. Нужна, чтобы при лежащей Флибусте не ждать
 * таймаутов на каждую книгу (fetchFromMirrors: 2 прохода × 2 зеркала ×
 * 15 с) и сразу идти в запасной источник, и чтобы карточка честно сказала,
 * что источник недоступен.
 */
export async function isFlibustaUp(): Promise<boolean> {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.up;
  if (probing) return probing;
  probing = (async () => {
    const attempts = MIRRORS.flatMap((base) =>
      PROBE_BOOKS.map(async (bookId) => {
        const res = await fetch(`${base}/b/${bookId}/fb2`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(8_000),
          cache: 'no-store',
          // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
          dispatcher: vlessDispatcher(),
        });
        const body = await res.arrayBuffer();
        if (!res.ok || !looksLikeBook(body, 'fb2')) throw new Error(`HTTP ${res.status}`);
        return true;
      }),
    );
    const up = await Promise.any(attempts).catch(() => false);
    probe = { at: Date.now(), up };
    return up;
  })().finally(() => {
    probing = null;
  });
  return probing;
}

/** Файл не скачался, хотя проверка говорила «работает», — минуту больше
 *  не ждём Флибусту: следующие книги сразу идут в запасной источник. */
function markFlibustaDown(): void {
  probe = { at: Date.now(), up: false };
}

// ─────────────────────────── Файл книги ───────────────────────────

/** Неудачный поиск в КулЛибе повторяем не раньше чем через столько. */
const COOLLIB_RECHECK_MS = 14 * 24 * 60 * 60 * 1000;

interface CoollibState {
  id: number | null;
  formats: BookFormat[];
  checkedAt: string | null;
}

/**
 * Книга в КулЛибе: из каталога (book_index.coollib_*), а не проверяли или
 * проверяли давно — поиском, с записью результата. null — нет.
 */
export async function coollibFor(bookId: number): Promise<CoollibState | null> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from('book_index')
    .select('title, author, coollib_id, coollib_formats, coollib_checked_at')
    .eq('book_id', bookId)
    .maybeSingle();
  if (!row) return null;
  const known: CoollibState = {
    id: row.coollib_id == null ? null : Number(row.coollib_id),
    formats: (row.coollib_formats ?? []) as BookFormat[],
    checkedAt: (row.coollib_checked_at as string | null) ?? null,
  };
  const fresh = known.checkedAt && Date.now() - new Date(known.checkedAt).getTime() < COOLLIB_RECHECK_MS;
  if (known.id != null || fresh) return known.id != null ? known : null;

  const found = await findCoollibBook(String(row.title ?? ''), (row.author as string | null) ?? null);
  // undefined — КулЛиб не ответил: ничего не записываем, спросим в другой раз.
  if (found === undefined) return null;
  const checkedAt = new Date().toISOString();
  await supabase
    .from('book_index')
    .update({ coollib_id: found?.id ?? null, coollib_formats: found?.formats ?? [], coollib_checked_at: checkedAt })
    .eq('book_id', bookId);
  return found ? { id: found.id, formats: found.formats, checkedAt } : null;
}

/**
 * Файл книги — из первого места, где он есть (24.10.2026):
 *   1. сохранённый пользователем на сервере (lib/bookDisk.ts, миграция 0058);
 *   2. кэш на диске (lib/bookCache.ts): всё, что уже открывали, и запас
 *      популярного (крон prefetch-books);
 *   3. Флибуста — если отвечает (isFlibustaUp), иначе её не ждём;
 *   4. КулЛиб — запасной источник, поиск по названию и автору.
 * Скачанное с Флибусты или КулЛиба кладём в кэш: в следующий сбой книга
 * откроется. Используется роутом /api/books/[id]/file и кроном запаса.
 */
export async function fetchBookFile(
  id: number,
  format: BookFormat,
  options: { skipFallback?: boolean } = {},
): Promise<{ body: ArrayBuffer; contentType: string; source: BookFileSource } | null> {
  const contentType = format === 'epub' ? 'application/epub+zip' : 'application/octet-stream';

  const stored = await readStoredBookFile(id, format);
  if (stored) return { body: stored, contentType, source: 'saved' };

  const cached = await readCachedBookFile(id, format);
  if (cached) return { body: cached, contentType, source: 'cache' };

  if (await isFlibustaUp()) {
    const hit = await fetchFromMirrors(`/b/${id}/${format}`);
    if (hit) {
      const body = await hit.res.arrayBuffer();
      // Флибуста на несуществующую книгу отвечает не 404, а HTML-страницей с
      // кодом 200 — проверяем сигнатуру до отдачи и до кэша.
      if (looksLikeBook(body, format)) {
        await writeCachedBookFile(id, format, body);
        return { body, contentType: hit.res.headers.get('content-type') ?? contentType, source: 'flibusta' };
      }
      console.warn(`[books] ${id}.${format}: Флибуста вернула не файл книги (${body.byteLength} байт)`);
    } else {
      markFlibustaDown();
    }
  }

  if (options.skipFallback) return null;
  const coollib = await coollibFor(id);
  if (coollib?.id != null && coollib.formats.includes(format)) {
    const body = await fetchCoollibFile(coollib.id, format);
    if (body) {
      await writeCachedBookFile(id, format, body);
      return { body, contentType, source: 'coollib' };
    }
  }
  return null;
}

// ─────────────────────────── Доступность книги ───────────────────────────

export interface BookAvailability {
  /** Откуда откроется: наш диск, Флибуста, КулЛиб или ниоткуда. */
  source: 'local' | 'flibusta' | 'coollib' | 'none';
  /** Каким форматом открывать: EPUB, а нет его — FB2 (читалка FB2). */
  format: BookFormat | null;
  flibustaUp: boolean;
}

/**
 * Откроется ли книга прямо сейчас и откуда — для карточки (24.10.2026: при
 * лежащей Флибусте «Читать» вела в читалку с ошибкой). КулЛиб ищем только
 * когда Флибуста не отвечает и своей копии нет: поиск — запрос к чужому
 * сайту, и на каждом открытии карточки он не нужен.
 */
export async function getBookAvailability(id: number, saved: boolean): Promise<BookAvailability> {
  const [cachedFormats, flibustaUp] = await Promise.all([cachedBookFormats(id), isFlibustaUp()]);
  const local = new Set<BookFormat>(cachedFormats);
  if (saved) local.add('epub');
  if (local.size > 0) {
    return { source: 'local', format: local.has('epub') ? 'epub' : 'fb2', flibustaUp };
  }
  if (flibustaUp) return { source: 'flibusta', format: 'epub', flibustaUp };
  const coollib = await coollibFor(id).catch(() => null);
  if (coollib?.id != null && coollib.formats.length > 0) {
    // FB2, даже если в каталоге КулЛиба указан EPUB: EPUB у них собирается
    // не для всех книг, и ссылка отвечает 404 (проверено на «Мастере и
    // Маргарите», 24.10.2026), а FB2 отдаётся всегда.
    return { source: 'coollib', format: coollib.formats.includes('fb2') ? 'fb2' : 'epub', flibustaUp };
  }
  return { source: 'none', format: null, flibustaUp };
}

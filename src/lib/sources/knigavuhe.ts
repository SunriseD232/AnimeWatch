import { signPodcastAudioUrl } from '@/lib/extract/proxy';
import { decodeHtmlEntities } from '@/lib/sources/text';
import type { AudiobookChapter, AudiobookSummary } from '@/lib/audiobookShared';

/**
 * knigavuhe.org — источник аудиокниг (миграция 0064). API у сайта нет,
 * поэтому разбираем HTML, но в узких местах:
 *
 *   • список «Новинки» (/new/?page=N, по 10 книг): название, авторы, жанры,
 *     аннотация, чтецы, длительность, просмотры, лайки, обложка. id книги —
 *     число в пути обложки (/covers/{id}/); проверено на выборке 24.10.2026:
 *     обложка есть у каждой книги списка;
 *   • страница книги (/book/{slug}/): вызов BookPlayer({id}, [главы], …) с
 *     JSON глав — id, название, прямой mp3 и длительность.
 *
 * mp3 и обложки отдаются без ограничений по Referer, с поддержкой Range
 * (проверено с VPS и с Referer media-watch.ru), поэтому браузер берёт их
 * напрямую — трафик книги не идёт через наш сервер. Прокси — только запасной
 * путь для звука (AudiobookChapter.fallbackUrl).
 */

const SITE_BASE = 'https://knigavuhe.org';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 20_000;
/** Аннотация в индексе — как у книг (0054): до 600 символов. */
const ANNOTATION_MAX = 600;

async function fetchHtml(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${SITE_BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) {
      console.error(`[knigavuhe] HTTP ${response.status} ${path}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    console.error(`[knigavuhe] ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function text(html: string | undefined | null): string {
  if (!html) return '';
  return (decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')) ?? '').replace(/\s+/g, ' ').trim();
}

/** Тексты ссылок внутри куска разметки: авторы, чтецы, жанры. */
function linkTexts(html: string | undefined): string[] {
  if (!html) return [];
  const out: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
    const value = text(match[1]);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function intOf(value: string | undefined): number | null {
  const digits = (value ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/** «9 часов 18 минут», «1 день 2 часа», «45 минут 10 секунд» → секунды. */
export function parseRuDuration(value: string): number | null {
  let total = 0;
  let found = false;
  const units: [RegExp, number][] = [
    [/(\d+)\s*(?:день|дня|дней)/, 86_400],
    [/(\d+)\s*час/, 3_600],
    [/(\d+)\s*мин/, 60],
    [/(\d+)\s*сек/, 1],
  ];
  for (const [re, factor] of units) {
    const match = value.match(re);
    if (match) {
      total += Number(match[1]) * factor;
      found = true;
    }
  }
  return found ? total : null;
}

/** Блок элемента списка → поле по классу (до закрывающего тега блока). */
function block(html: string, className: string): string | undefined {
  const re = new RegExp(`class="${className}"[^>]*>([\\s\\S]*?)</(?:div|span)>\\s*(?:<div|</div)`);
  return html.match(re)?.[1];
}

/** Одна книга из списка. null — запись без id или названия. */
export function parseListItem(html: string): AudiobookSummary | null {
  const slug = html.match(/href="\/book\/([^"/]+)\/"/)?.[1];
  const id = Number(html.match(/\/covers\/(\d+)\//)?.[1]);
  const title = text(html.match(/<a[^>]*class="bookkitem_name"[^>]*>([\s\S]*?)<\/a>/)?.[1]);
  if (!slug || !Number.isSafeInteger(id) || id <= 0 || !title) return null;

  const cover = html.match(/class="bookkitem_cover_img"[^>]*src="([^"]+)"/)?.[1] ?? null;
  const authorsHtml = html.match(/class="bookkitem_author">([\s\S]*?)<\/span>\s*<\/div>/)?.[1];
  const genresHtml = block(html, 'bookkitem_genre');
  const annotation = text(html.match(/class="bookkitem_about">([\s\S]*?)<\/div>/)?.[1]);
  const readersHtml = html.match(/-reader"><\/span>([\s\S]*?)<\/div>/)?.[1];
  const time = text(html.match(/class="bookkitem_meta_time">([\s\S]*?)<\/span>/)?.[1]);
  const counters = [...html.matchAll(/class="bookkitem_meta_label -not_last">([^<]*)</g)].map((m) => m[1]);

  return {
    id,
    slug,
    title,
    authors: linkTexts(authorsHtml),
    readers: linkTexts(readersHtml),
    genres: linkTexts(genresHtml),
    annotation: annotation ? annotation.slice(0, ANNOTATION_MAX) : null,
    durationSeconds: time ? parseRuDuration(time) : null,
    coverUrl: decodeHtmlEntities(cover),
    views: intOf(counters[0]),
    likes: intOf(counters[1]),
    bookId: null,
  };
}

/**
 * Страница списка новинок. null — сайт не ответил (обход повторит);
 * пустой массив — страница за концом списка.
 */
export async function fetchKnigavuheListPage(page: number): Promise<AudiobookSummary[] | null> {
  const html = await fetchHtml(page > 1 ? `/new/?page=${page}` : '/new/');
  if (html == null) return null;
  return html
    .split('class="bookkitem"')
    .slice(1)
    .map(parseListItem)
    .filter((item): item is AudiobookSummary => item !== null);
}

export interface KnigavuheBook {
  id: number;
  chapters: AudiobookChapter[];
  description: string | null;
}

/** Главы и полная аннотация со страницы книги. null — страница не пришла
 *  или плеера на ней нет (книгу сняли). */
export async function fetchKnigavuheBook(slug: string): Promise<KnigavuheBook | null> {
  const html = await fetchHtml(`/book/${encodeURIComponent(slug)}/`);
  if (!html) return null;
  return parseBookPage(html);
}

export function parseBookPage(html: string): KnigavuheBook | null {
  const start = html.match(/BookPlayer\((\d+),\s*/);
  if (!start || start.index === undefined) return null;
  const id = Number(start[1]);
  const json = readJsonArray(html, start.index + start[0].length);
  if (!json) return null;

  const chapters: AudiobookChapter[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as { title?: unknown; url?: unknown; duration?: unknown; error?: unknown };
    if (typeof item.url !== 'string' || !/^https:\/\//.test(item.url)) continue;
    const url = item.url;
    chapters.push({
      index: chapters.length + 1,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Часть ${chapters.length + 1}`,
      url,
      fallbackUrl: knigavuheFallbackUrl(url),
      durationSeconds: Number(item.duration) > 0 ? Number(item.duration) : 0,
    });
  }
  if (chapters.length === 0) return null;

  const description = text(html.match(/itemprop="description">([\s\S]*?)<\/div>/)?.[1]) || null;
  return { id, chapters, description };
}

/** Запасная ссылка через прокси. Без секрета (локальная сборка) — та же
 *  прямая: запасного пути не будет, но страница не упадёт. */
export function knigavuheFallbackUrl(url: string): string {
  try {
    return signPodcastAudioUrl(url);
  } catch {
    return url;
  }
}

/** JSON-массив, начинающийся с позиции from (до парной скобки). */
function readJsonArray(source: string, from: number): unknown[] | null {
  if (source[from] !== '[') return null;
  let depth = 0;
  let inString = false;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const value = JSON.parse(source.slice(from, i + 1)) as unknown;
          return Array.isArray(value) ? value : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function knigavuheBookUrl(slug: string): string {
  return `${SITE_BASE}/book/${encodeURIComponent(slug)}/`;
}

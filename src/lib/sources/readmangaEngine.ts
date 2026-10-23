/**
 * Общий адаптер для сайтов движка ReadManga: SelfManga, MintManga.
 *
 * Проверено живьём 23.10.2026:
 *   - поиск:  GET {host}/api/catalog/search?q=...      (JSON)
 *   - тайтл:  GET {host}/{slug}                        (HTML, chapter links)
 *   - глава:  GET {host}/{slug}/vol{vol}/{num}         (HTML, rm_h.readerInit)
 *   - картинки: base + path из rm_h.readerInit; хост *.one-way.work
 *
 * Особенности:
 *   - HTML-страницы MintManga требуют Referer, иначе 404;
 *   - 18+ главы MintManga уводят на логин (save-mature), поэтому getChapter
 *     вернёт null — обходить авторизацию нельзя;
 *   - страницы отдаются массивом JS, а не JSON, поэтому парсим с балансом
 *     скобок, а не жадной регуляркой.
 */

import { signRawUrl } from '@/lib/extract/proxy';
import { formatChapterLabel } from './chapterLabel';
import { isSourceEnabled, recordSourceError, recordSourceOk } from './health';
import { titleScore } from './text';
import type {
  ResolvedContent,
  SourceAdapter,
  SourceChapter,
  SourceId,
  SourceMatch,
  SourceTitleKey,
} from './types';

const USER_AGENT = 'MediaWatch/1.0 (+manga; contact: site admin)';
const REQUEST_TIMEOUT_MS = 25_000;
const MIN_SPACING_MS = 350;
const MATCH_THRESHOLD = 0.6;
const SEARCH_LIMIT = 50;

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
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ReadmangaEngineOptions {
  id: Extract<SourceId, 'selfmanga' | 'mintmanga'>;
  /** Базовый URL без слэша: https://1.selfmanga.live */
  host: string;
}

export function createReadmangaEngineAdapter(
  options: ReadmangaEngineOptions,
): SourceAdapter {
  const { id, host } = options;

  let queue: Promise<unknown> = Promise.resolve();
  let lastCallAt = 0;

  function paced<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = Math.max(0, MIN_SPACING_MS - (Date.now() - lastCallAt));
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();
      return task();
    });

    queue = run.catch(() => undefined);
    return run;
  }

  async function request(path: string, accept: string): Promise<Response | null> {
    const startedAt = Date.now();

    try {
      const response = await paced(() =>
        fetch(`${host}${path}`, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: accept,
            // MintManga без Referer отдаёт 404 на HTML-страницы.
            Referer: `${host}/`,
            'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: 'no-store',
        }),
      );

      if (!response.ok) {
        await recordSourceError(id, `HTTP ${response.status} ${path}`);
        return null;
      }

      await recordSourceOk(id, Date.now() - startedAt);
      return response;
    } catch (error) {
      await recordSourceError(id, error);
      return null;
    }
  }

  async function apiJson(path: string): Promise<JsonObject | null> {
    const response = await request(path, 'application/json');
    if (!response) return null;

    try {
      return asObject(await response.json());
    } catch {
      return null;
    }
  }

  async function fetchHtml(path: string): Promise<string | null> {
    const response = await request(
      path,
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    );
    if (!response) return null;

    try {
      return await response.text();
    } catch {
      return null;
    }
  }

  function isAllowedUpstream(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return (
        hostname.endsWith('.one-way.work') ||
        hostname.endsWith('.imglib.info') ||
        hostname.endsWith('.grouple.co')
      );
    } catch {
      return false;
    }
  }

  function safeSignImage(url: string): string {
    try {
      return signRawUrl(url, { Referer: `${host}/` });
    } catch {
      return url;
    }
  }

  /**
   * Достаёт массив страниц из `rm_h.readerInit(chapterInfo, [ ... ])`.
   * Скобки считаем вручную: жадная регулярка захватывала бы остаток HTML.
   */
  function extractPages(html: string): {
    base: string;
    path: string;
    width?: number;
    height?: number;
  }[] {
    const marker = 'rm_h.readerInit(';
    const callStart = html.indexOf(marker);
    if (callStart < 0) return [];

    const comma = html.indexOf(',', callStart);
    if (comma < 0) return [];

    const arrayStart = html.indexOf('[', comma);
    if (arrayStart < 0) return [];

    let depth = 0;
    let arrayEnd = -1;

    for (let i = arrayStart; i < html.length; i += 1) {
      const char = html[i];
      if (char === '[') depth += 1;
      else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          arrayEnd = i;
          break;
        }
      }
    }

    if (arrayEnd < 0) return [];

    const arrayText = html.slice(arrayStart, arrayEnd + 1);
    const entryRe =
      /\[\s*['"]([^'"]+)['"]\s*,\s*['"][^'"]*['"]\s*,\s*["']([^"']+)["']\s*,\s*(\d+)\s*,\s*(\d+)/g;

    const pages: {
      base: string;
      path: string;
      width?: number;
      height?: number;
    }[] = [];

    for (const match of arrayText.matchAll(entryRe)) {
      const base = match[1];
      const path = match[2];
      const width = asNumber(match[3]);
      const height = asNumber(match[4]);
      pages.push({
        base,
        path,
        width: width ?? undefined,
        height: height ?? undefined,
      });
    }

    return pages;
  }

  return {
    id,
    kind: 'manga',
    granularity: 'chapter',

    isEnabled(): boolean {
      return isSourceEnabled(id);
    },

    async findByTitle(input: SourceTitleKey): Promise<SourceMatch | null> {
      const query = input.title.trim();
      if (!query) return null;

      const json = await apiJson(
        `/api/catalog/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}&offset=0`,
      );
      const list = asArray(json?.list);
      if (list.length === 0) return null;

      const targets = [input.title, ...(input.altTitles ?? [])];
      let best: { item: JsonObject; score: number } | null = null;

      for (const raw of list) {
        const item = asObject(raw);
        const element = item ? asObject(item.elementId) : null;
        if (!item || !element) continue;

        const linkName = asText(element.linkName);
        const name = asText(item.name);
        if (!linkName || !name) continue;

        const elements = asArray(item.elements);
        const altNames: string[] = [];
        let year: number | null = null;

        for (const rawElement of elements) {
          const entry = asObject(rawElement);
          if (!entry) continue;
          const typeName = asText(entry.typeName);
          const entryName = asText(entry.name);
          if (!entryName) continue;
          if (typeName === 'another') altNames.push(entryName);
          if (typeName === 'year') year = asNumber(entryName);
        }

        let score = titleScore([name, ...altNames], targets);
        if (score < MATCH_THRESHOLD) continue;

        if (year != null && input.year != null && Math.abs(year - input.year) <= 1) {
          score = Math.min(1, score + 0.05);
        }

        if (!best || score > best.score) best = { item, score };
      }

      if (!best || best.score < MATCH_THRESHOLD) return null;

      const element = asObject(best.item.elementId);
      const linkName = element ? asText(element.linkName) : null;
      const title = asText(best.item.name);
      if (!linkName || !title) return null;

      return {
        source: id,
        externalId: linkName,
        variant: 'default',
        title,
        confidence: best.score,
        chaptersCount: asNumber(best.item.chaptersCount) ?? undefined,
        language: 'ru',
        externalUrl: `${host}/${linkName}`,
      };
    },

    async listChapters(match: SourceMatch): Promise<SourceChapter[]> {
      const html = await fetchHtml(`/${encodeURIComponent(match.externalId)}`);
      if (!html) return [];

      const slug = escapeRegExp(match.externalId);
      const linkRe = new RegExp(
        `href=["'](/${slug}/vol(\\d+)/(\\d+))`,
        'g',
      );

      const byKey = new Map<string, SourceChapter>();

      for (const found of html.matchAll(linkRe)) {
        const href = found[1];
        const volume = found[2];
        const number = found[3];
        const key = `${volume}/${number}`;
        if (byKey.has(key)) continue;

        const tome = Number(volume);
        const chapterNo = Number(number);

        byKey.set(key, {
          source: id,
          chapterKey: href,
          chapterNo,
          tome,
          label: formatChapterLabel({ tome, number }),
          isPaid: false,
          isFreeToday: false,
        });
      }

      return [...byKey.values()].sort(
        (a, b) =>
          (a.tome ?? 0) - (b.tome ?? 0) ||
          (a.chapterNo ?? 0) - (b.chapterNo ?? 0),
      );
    },

    async getChapter(
      match: SourceMatch,
      chapterKey: string,
    ): Promise<ResolvedContent | null> {
      if (!chapterKey.startsWith(`/${match.externalId}/`)) return null;

      const html = await fetchHtml(chapterKey);
      if (!html) return null;

      // 18+ на MintManga уводит на логин — не обходим.
      if (html.includes('save-mature') || html.includes('/internal/auth/login')) {
        return null;
      }

      const pages: { url: string; width?: number; height?: number }[] = [];

      for (const page of extractPages(html)) {
        const base = page.base
          ? page.base.endsWith('/')
            ? page.base
            : `${page.base}/`
          : '';
        // Query-подпись (?t=…&u=…&h=…) отбрасываем: с ней CDN one-way.work
        // на любой серверный запрос отвечает 300 с редиректом на картинку-
        // заглушку (фото тыкв с Википедии) — и с VPS, и через туннель, с
        // любыми Referer/cookie. Тот же путь без query отдаёт настоящую
        // страницу (проверено с VPS 23.10.2026: три страницы подряд — разные
        // JPEG 800×1200). Если CDN начнёт требовать подпись и здесь, вместо
        // страниц снова придёт заглушка — тогда источник проще выключить
        // флагом SOURCE_SELFMANGA=disabled.
        const path = page.path.replace(/^\/+/, '').split('?')[0];
        const direct = `${base}${path}`;

        if (!direct || !isAllowedUpstream(direct)) continue;

        pages.push({
          url: safeSignImage(direct),
          width: page.width,
          height: page.height,
        });
      }

      if (pages.length === 0) return null;
      return { format: 'images', pages };
    },
  };
}

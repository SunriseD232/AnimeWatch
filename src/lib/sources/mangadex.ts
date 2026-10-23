/**
 * MangaDex — основной бесплатный источник манги.
 *
 * Официальный публичный API. Платных глав нет: только фанатские переводы.
 * Страницы отдаются через `at-home`, чей `baseUrl` живёт ~15 минут — поэтому
 * мы НЕ кэшируем готовые ссылки, а запрашиваем at-home при каждом открытии
 * главы.
 *
 * Маппинг на тайтл: по названию/altTitles/году, НЕ по myanimelist_id (в
 * manga_index его нет).
 */

import { signImageUrl } from '@/lib/extract/proxy';
import { formatChapterLabel, normalizeChapterNo } from './chapterLabel';
import { isSourceEnabled, recordSourceError, recordSourceOk } from './health';
import { titleScore } from './text';
import type {
  ResolvedContent,
  SourceAdapter,
  SourceChapter,
  SourceMatch,
  SourceTitleKey,
} from './types';

const API_BASE = 'https://api.mangadex.org';
const SITE_BASE = 'https://mangadex.org';

const USER_AGENT = 'MediaWatch/1.0 (+manga; contact: site admin)';
const REQUEST_TIMEOUT_MS = 15_000;

/** MangaDex просит разумные лимиты (~5 rps). Держим ~4.5 rps. */
const MIN_SPACING_MS = 220;

/** MangaDex отдаёт максимум 100 глав на страницу (limit=500 → 400). */
const CHAPTER_PAGE_SIZE = 100;
/** Предохранитель: 60 × 100 = 6000 глав. */
const MAX_CHAPTER_PAGES = 60;

/** Порог уверенности маппинга. */
const MATCH_THRESHOLD = 0.6;

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

// ─────────────────────────── Ограничитель запросов ───────────────────────────

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

async function apiJson(path: string): Promise<JsonObject | null> {
  const startedAt = Date.now();

  try {
    const response = await paced(() =>
      fetch(`${API_BASE}${path}`, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      }),
    );

    if (!response.ok) {
      await recordSourceError('mangadex', `HTTP ${response.status} ${path}`);
      return null;
    }

    const json = (await response.json()) as unknown;
    await recordSourceOk('mangadex', Date.now() - startedAt);
    return asObject(json);
  } catch (error) {
    await recordSourceError('mangadex', error);
    return null;
  }
}

// ─────────────────────────── Названия ───────────────────────────

function collectTitles(attributes: JsonObject): string[] {
  const titles: string[] = [];

  const titleObject = asObject(attributes.title);
  if (titleObject) {
    for (const value of Object.values(titleObject)) {
      const title = asText(value);
      if (title) titles.push(title);
    }
  }

  for (const entry of asArray(attributes.altTitles)) {
    const alt = asObject(entry);
    if (!alt) continue;
    for (const value of Object.values(alt)) {
      const title = asText(value);
      if (title) titles.push(title);
    }
  }

  return titles;
}

function primaryTitle(attributes: JsonObject, fallback: string): string {
  const titleObject = asObject(attributes.title);
  if (!titleObject) return fallback;

  const preferred = ['en', 'ru', 'ja-ro', 'ja'];
  for (const key of preferred) {
    const title = asText(titleObject[key]);
    if (title) return title;
  }

  for (const value of Object.values(titleObject)) {
    const title = asText(value);
    if (title) return title;
  }

  return fallback;
}

// ─────────────────────────── Безопасная подпись ───────────────────────────

function isAllowedUpstream(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('.mangadex.network') || host.endsWith('.mangadex.org');
  } catch {
    return false;
  }
}

function safeSignImage(url: string): string {
  try {
    return signImageUrl(url);
  } catch {
    // PROXY_SIGNING_SECRET не задан (локальная сборка) — отдаём прямой URL.
    return url;
  }
}

// ─────────────────────────── Адаптер ───────────────────────────

export const mangadex: SourceAdapter = {
  id: 'mangadex',
  kind: 'manga',
  granularity: 'chapter',

  isEnabled(): boolean {
    return isSourceEnabled('mangadex');
  },

  async findByTitle(input: SourceTitleKey): Promise<SourceMatch | null> {
    const query = input.title.trim();
    if (!query) return null;

    const json = await apiJson(
      `/manga?title=${encodeURIComponent(query)}&limit=10&includes[]=cover_art`,
    );
    const data = asArray(json?.data);
    if (data.length === 0) return null;

    const targets = [input.title, ...(input.altTitles ?? [])];
    let best: { attributes: JsonObject; id: string; score: number } | null = null;

    for (const raw of data) {
      const item = asObject(raw);
      if (!item) continue;

      const attributes = asObject(item.attributes);
      const id = asText(item.id);
      if (!attributes || !id) continue;

      const names = collectTitles(attributes);
      let score = titleScore(names, targets);
      if (score < MATCH_THRESHOLD) continue;

      const year = asNumber(attributes.year);
      if (year != null && input.year != null && Math.abs(year - input.year) <= 1) {
        score = Math.min(1, score + 0.05);
      }

      const links = asObject(attributes.links);
      if (links && asText(links.mal)) {
        score = Math.min(1, score + 0.02);
      }

      if (!best || score > best.score) {
        best = { attributes, id, score };
      }
    }

    if (!best || best.score < MATCH_THRESHOLD) return null;

    return {
      source: 'mangadex',
      externalId: best.id,
      variant: 'ru',
      title: primaryTitle(best.attributes, input.title),
      confidence: best.score,
      language: 'ru',
      externalUrl: `${SITE_BASE}/title/${best.id}`,
    };
  },

  async listChapters(match: SourceMatch): Promise<SourceChapter[]> {
    const byNumber = new Map<string, SourceChapter>();
    let offset = 0;

    for (let page = 0; page < MAX_CHAPTER_PAGES; page += 1) {
      const json = await apiJson(
        `/chapter?manga=${encodeURIComponent(match.externalId)}` +
          `&translatedLanguage[]=ru&order[chapter]=asc` +
          `&limit=${CHAPTER_PAGE_SIZE}&offset=${offset}`,
      );

      const data = asArray(json?.data);
      if (data.length === 0) break;

      for (const raw of data) {
        const item = asObject(raw);
        const attributes = item ? asObject(item.attributes) : null;
        const id = item ? asText(item.id) : null;
        if (!item || !attributes || !id) continue;

        // Внешние главы (ссылка на другой сайт) мы не читаем.
        if (asText(attributes.externalUrl)) continue;

        const pages = asNumber(attributes.pages) ?? 0;
        if (pages <= 0) continue;

        const numberRaw = asText(attributes.chapter);
        const chapterNo = normalizeChapterNo(numberRaw);
        const name = asText(attributes.title);

        const chapter: SourceChapter = {
          source: 'mangadex',
          chapterKey: id,
          chapterNo,
          tome: asNumber(attributes.volume),
          label: formatChapterLabel({ number: numberRaw, name }),
          isPaid: false,
          isFreeToday: false,
          pagesCount: pages,
        };

        const key = chapterNo != null ? `n:${chapterNo}` : `id:${id}`;
        const existing = byNumber.get(key);
        if (
          !existing ||
          (chapter.pagesCount ?? 0) > (existing.pagesCount ?? 0)
        ) {
          byNumber.set(key, chapter);
        }
      }

      if (data.length < CHAPTER_PAGE_SIZE) break;
      offset += CHAPTER_PAGE_SIZE;
    }

    return [...byNumber.values()].sort(
      (a, b) => (a.chapterNo ?? Number.POSITIVE_INFINITY) - (b.chapterNo ?? Number.POSITIVE_INFINITY),
    );
  },

  async getChapter(
    _match: SourceMatch,
    chapterKey: string,
  ): Promise<ResolvedContent | null> {
    const json = await apiJson(
      `/at-home/server/${encodeURIComponent(chapterKey)}`,
    );
    if (!json) return null;

    const baseUrl = asText(json.baseUrl);
    const chapter = asObject(json.chapter);
    const hash = chapter ? asText(chapter.hash) : null;
    if (!baseUrl || !hash || !chapter) return null;

    const saver = asArray(chapter.dataSaver);
    const full = asArray(chapter.data);
    const useSaver = saver.length > 0;
    const files = useSaver ? saver : full;
    if (files.length === 0) return null;

    const segment = useSaver ? 'data-saver' : 'data';
    const pages: { url: string }[] = [];

    for (const entry of files) {
      const file = asText(entry);
      if (!file) continue;

      // baseUrl динамический (*.mangadex.network), поэтому проверяем суффикс,
      // а не точный хост.
      const direct = `${baseUrl}/${segment}/${hash}/${file}`;
      if (!isAllowedUpstream(direct)) continue;

      pages.push({ url: safeSignImage(direct) });
    }

    if (pages.length === 0) return null;
    return { format: 'images', pages };
  },
};

/**
 * MangaLib — фанатские переводы манги/манхвы/маньхуа.
 *
 * Проверено живьём 23.10.2026:
 *   GET https://api.cdnlibs.org/api/manga?q=...&limit=20&site_id[]=1
 *   GET https://api.cdnlibs.org/api/manga/{slug}/chapters?site_id[]=1
 *   GET https://api.cdnlibs.org/api/manga/{slug}/chapter?number=&volume=&branch_id=&site_id[]=1
 *
 * Картинки: страница отдаёт `url` вида `//manga/{slug}/chapters/{id}/{file}`,
 * хост — `https://img2.imglib.info` (проверено: 206 image/jpeg).
 *
 * Источник неофициальный: API может измениться. Поэтому адаптер вторичен,
 * ошибки не кэшируются, а источник отключается флагом SOURCE_MANGALIB.
 */

import { signImageUrlWithHeaders, signRawUrl } from '@/lib/extract/proxy';
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

const API_BASE = 'https://api.cdnlibs.org/api';
const SITE_BASE = 'https://mangalib.me';
/**
 * Сервер «Сжатия» (compress) из официального списка
 * `/api/constants?fields[]=imageServers`. Основной `img2.imglib.info` с
 * 23.10.2026 отвечает 403 на любой серверный запрос — с Referer и без, и
 * напрямую с VPS, и через туннель, — а этот отдаёт те же страницы (JPEG
 * вместо PNG, легче) без условий.
 */
const IMAGE_BASE = 'https://img3.cdnlibs.org';

const USER_AGENT = 'MediaWatch/1.0 (+manga; contact: site admin)';
const REQUEST_TIMEOUT_MS = 20_000;

/** Не частим: источник неофициальный. */
const MIN_SPACING_MS = 300;
const SEARCH_LIMIT = 20; // API принимает 10..60
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
          Referer: `${SITE_BASE}/`,
          // Без Site-Id карточка тайтла (/manga/{slug}) отвечает 404, хотя
          // поиск и главы работают (проверено 24.10.2026).
          'Site-Id': '1',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      }),
    );

    if (!response.ok) {
      await recordSourceError('mangalib', `HTTP ${response.status} ${path}`);
      return null;
    }

    const json = (await response.json()) as unknown;
    await recordSourceOk('mangalib', Date.now() - startedAt);
    return asObject(json);
  } catch (error) {
    await recordSourceError('mangalib', error);
    return null;
  }
}

function parseYear(value: unknown): number | null {
  const text = asText(value);
  if (!text) return null;
  const match = text.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function titleNames(item: JsonObject): string[] {
  return [item.rus_name, item.name, item.eng_name]
    .map(asText)
    .filter((value): value is string => value !== null);
}

function titleOf(item: JsonObject): string | null {
  return asText(item.rus_name) ?? asText(item.name) ?? asText(item.eng_name);
}

function isAllowedUpstream(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith('.cdnlibs.org') || hostname.endsWith('.imglib.info');
  } catch {
    return false;
  }
}

function safeSignImage(url: string): string {
  try {
    // img2.imglib.info отдаёт 206 только с Referer'ом; без него — 403.
    return signRawUrl(url, { Referer: `${SITE_BASE}/` });
  } catch {
    return url;
  }
}

/**
 * Ключ главы: `volume|number|branchId`. Все три части допускают пустое
 * значение, поэтому split всегда даёт три элемента.
 */
function makeChapterKey(volume: string | null, number: string, branchId: string | null): string {
  return `${volume ?? ''}|${number}|${branchId ?? ''}`;
}

function parseChapterKey(key: string): {
  volume: string;
  number: string;
  branchId: string | null;
} {
  const [volume = '', number = '', branchId = ''] = key.split('|');
  return { volume, number, branchId: branchId || null };
}

export const mangalib: SourceAdapter = {
  id: 'mangalib',
  kind: 'manga',
  granularity: 'chapter',

  isEnabled(): boolean {
    return isSourceEnabled('mangalib');
  },

  async findByTitle(input: SourceTitleKey): Promise<SourceMatch | null> {
    const query = input.title.trim();
    if (!query) return null;

    const json = await apiJson(
      `/manga?q=${encodeURIComponent(query)}&page=1&limit=${SEARCH_LIMIT}&site_id[]=1`,
    );
    const data = asArray(json?.data);
    if (data.length === 0) return null;

    const targets = [input.title, ...(input.altTitles ?? [])];
    let best: { item: JsonObject; score: number } | null = null;

    for (const raw of data) {
      const item = asObject(raw);
      if (!item) continue;
      const slug = asText(item.slug) ?? asText(item.slug_url);
      if (!slug) continue;

      let score = titleScore(titleNames(item), targets);
      if (score < MATCH_THRESHOLD) continue;

      const year = parseYear(item.releaseDateString);
      if (year != null && input.year != null && Math.abs(year - input.year) <= 1) {
        score = Math.min(1, score + 0.05);
      }

      if (!best || score > best.score) best = { item, score };
    }

    if (!best || best.score < MATCH_THRESHOLD) return null;

    const slug = asText(best.item.slug) ?? asText(best.item.slug_url);
    const title = titleOf(best.item);
    const slugUrl = asText(best.item.slug_url) ?? slug;
    if (!slug || !title) return null;

    return {
      source: 'mangalib',
      externalId: slug,
      variant: 'default',
      title,
      confidence: best.score,
      language: 'ru',
      externalUrl: `${SITE_BASE}/manga/${slugUrl}`,
    };
  },

  async listChapters(match: SourceMatch): Promise<SourceChapter[]> {
    const json = await apiJson(
      `/manga/${encodeURIComponent(match.externalId)}/chapters?site_id[]=1`,
    );
    const data = asArray(json?.data);
    const chapters: SourceChapter[] = [];

    for (const raw of data) {
      const item = asObject(raw);
      if (!item) continue;

      const number = asText(item.number);
      if (!number) continue;

      const volume = asText(item.volume);
      const branches = asArray(item.branches);
      const branch = branches.length > 0 ? asObject(branches[0]) : null;
      const branchId = branch ? asText(branch.branch_id) : null;

      const volumeNumber = volume ? Number(volume) : null;

      chapters.push({
        source: 'mangalib',
        chapterKey: makeChapterKey(volume, number, branchId),
        chapterNo: normalizeChapterNo(number),
        tome: volumeNumber != null && Number.isFinite(volumeNumber) ? volumeNumber : null,
        label: formatChapterLabel({
          tome: volumeNumber,
          number,
          name: asText(item.name),
        }),
        // MangaLib — фанатские переводы. Платных флагов в списке нет; если
        // источник закроет главу, getChapter вернёт null.
        isPaid: false,
        isFreeToday: false,
      });
    }

    return chapters.sort(
      (a, b) => (a.chapterNo ?? Number.POSITIVE_INFINITY) - (b.chapterNo ?? Number.POSITIVE_INFINITY),
    );
  },

  async getChapter(
    match: SourceMatch,
    chapterKey: string,
  ): Promise<ResolvedContent | null> {
    const { volume, number, branchId } = parseChapterKey(chapterKey);
    if (!number) return null;

    const params = new URLSearchParams({
      number,
      volume: volume || '1',
      'site_id[]': '1',
    });
    if (branchId) params.set('branch_id', branchId);

    const json = await apiJson(
      `/manga/${encodeURIComponent(match.externalId)}/chapter?${params.toString()}`,
    );
    const data = json ? asObject(json.data) : null;
    if (!data) return null;

    const pages: { url: string; width?: number; height?: number }[] = [];

    for (const raw of asArray(data.pages)) {
      const page = asObject(raw);
      if (!page) continue;

      const relative = asText(page.url);
      if (!relative) continue;

      const path = relative.startsWith('//')
        ? relative.slice(1)
        : relative.startsWith('/')
          ? relative
          : `/${relative}`;

      const direct = `${IMAGE_BASE}${path}`;
      if (!isAllowedUpstream(direct)) continue;

      pages.push({
        url: safeSignImage(direct),
        width: asNumber(page.width) ?? undefined,
        height: asNumber(page.height) ?? undefined,
      });
    }

    if (pages.length === 0) return null;
    return { format: 'images', pages };
  },
};

// ─────────────────────────── Каталог MangaLib ───────────────────────────
// Каталог манги у нас — объединение Remanga и MangaLib (lib/mangalibCatalog.ts):
// одинаковые тайтлы склеиваются в одну карточку, а тайтлы, которых у Remanga
// нет, получают свою — с адресом /manga/ml-<slug_url> и ключом
// MANGALIB_KEY_OFFSET + id MangaLib (он же shikimori_id прогресса).

/** Ключи тайтлов только с MangaLib: id Remanga (< 10⁶) с ними не пересекаются,
 *  а JS-число остаётся точным (< 2⁵³). */
export const MANGALIB_KEY_OFFSET = 10_000_000_000;

/** Префикс dir у карточек только с MangaLib. */
export const MANGALIB_DIR_PREFIX = 'ml-';

export function isMangaLibDir(dir: string): boolean {
  return dir.startsWith(MANGALIB_DIR_PREFIX);
}

export function mangaLibSiteUrl(slugUrl: string): string {
  return `https://mangalib.me/ru/manga/${slugUrl}`;
}

/** Обложка через наш прокси: cover.imglib.info без Referer отвечает 403. */
export function mangaLibCover(url: string | null): string | null {
  if (!url) return null;
  try {
    return signImageUrlWithHeaders(url, { Referer: `${SITE_BASE}/` });
  } catch {
    return url;
  }
}

export interface MangaLibListItem {
  id: number;
  slugUrl: string;
  rusName: string | null;
  engName: string | null;
  name: string | null;
  kind: string | null;
  status: string | null;
  year: number | null;
  rating: number | null;
  votes: number | null;
  /** Ссылка на обложку у источника, без подписи. */
  coverRaw: string | null;
}

function listItem(raw: unknown): MangaLibListItem | null {
  const item = asObject(raw);
  if (!item) return null;
  const id = asNumber(item.id);
  const slugUrl = asText(item.slug_url);
  if (id == null || !slugUrl) return null;
  const rating = asObject(item.rating);
  const cover = asObject(item.cover);
  return {
    id,
    slugUrl,
    rusName: asText(item.rus_name),
    engName: asText(item.eng_name),
    name: asText(item.name),
    kind: asText(asObject(item.type)?.label),
    status: asText(asObject(item.status)?.label),
    year: parseYear(item.releaseDateString ?? item.releaseDate),
    rating: rating ? asNumber(rating.average) : null,
    votes: rating ? asNumber(rating.votes) : null,
    coverRaw: cover ? asText(cover.default) ?? asText(cover.md) ?? asText(cover.thumbnail) : null,
  };
}

/**
 * Страница каталога по дате добавления (60 тайтлов). Весь каталог — ~690
 * страниц (24.10.2026), потолка в 1000 страниц, как у Remanga, он не
 * достигает. null — источник не ответил.
 */
export async function fetchMangaLibCatalogPage(
  page: number,
  filter: { genre?: number; tag?: number } = {},
): Promise<{ items: MangaLibListItem[]; hasNext: boolean } | null> {
  // Фильтр по жанру/тегу — для обхода по жанрам (lib/mangalibCatalog.ts):
  // сами жанры список не отдаёт, fields[]=genres он отклоняет с 422.
  const by =
    (filter.genre ? `&genres[]=${filter.genre}` : '') + (filter.tag ? `&tags[]=${filter.tag}` : '');
  const json = await apiJson(
    `/manga?site_id[]=1&sort_by=created_at&sort_type=desc&page=${page}${by}`,
  );
  if (!json) return null;
  const items = asArray(json.data)
    .map(listItem)
    .filter((item): item is MangaLibListItem => item !== null);
  const meta = asObject(json.meta);
  return { items, hasNext: meta?.has_next_page === true };
}

export interface MangaLibTaxon {
  id: number;
  name: string;
}

/**
 * Справочник жанров и тегов MangaLib (/constants; 24.10.2026 — 57 жанров и
 * 631 тег). Только те, что показываются на самом MangaLib (site_ids
 * содержит 1). null — источник не ответил.
 */
export async function fetchMangaLibTaxonomy(): Promise<{
  genres: MangaLibTaxon[];
  tags: MangaLibTaxon[];
} | null> {
  const json = await apiJson('/constants?fields[]=genres&fields[]=tags');
  const data = json ? asObject(json.data) : null;
  if (!data) return null;
  const list = (value: unknown): MangaLibTaxon[] =>
    asArray(value)
      .map((raw) => {
        const obj = asObject(raw);
        const id = obj ? asNumber(obj.id) : null;
        const name = obj ? asText(obj.name) : null;
        const sites = obj ? asArray(obj.site_ids).map(asNumber) : [];
        if (id == null || !name || (sites.length > 0 && !sites.includes(1))) return null;
        return { id, name };
      })
      .filter((item): item is MangaLibTaxon => item !== null);
  return { genres: list(data.genres), tags: list(data.tags) };
}

/** Описание MangaLib — документ ProseMirror; собираем текст по абзацам. */
function proseText(node: unknown): string {
  const obj = asObject(node);
  if (!obj) return typeof node === 'string' ? node : '';
  if (obj.type === 'text') return asText(obj.text) ?? '';
  const inner = asArray(obj.content).map(proseText).join('');
  return obj.type === 'paragraph' ? `${inner}\n` : inner;
}

export interface MangaLibDetails extends MangaLibListItem {
  description: string | null;
  genres: string[];
  otherNames: string[];
  chaptersCount: number | null;
}

/** Карточка тайтла MangaLib по slug_url (с числовым префиксом или без). */
export async function getMangaLibDetails(slugUrl: string): Promise<MangaLibDetails | null> {
  const json = await apiJson(
    `/manga/${encodeURIComponent(slugUrl)}?fields[]=summary&fields[]=genres&fields[]=otherNames&fields[]=releaseDate&fields[]=chap_count`,
  );
  const data = json ? asObject(json.data) : null;
  const base = data ? listItem(data) : null;
  if (!data || !base) return null;
  const summary = data.summary;
  const description = (typeof summary === 'string' ? summary : proseText(summary))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const count = asObject(data.items_count);
  return {
    ...base,
    description: description || null,
    genres: asArray(data.genres)
      .map((g) => asText(asObject(g)?.name))
      .filter((g): g is string => g !== null),
    otherNames: asArray(data.otherNames)
      .map(asText)
      .filter((n): n is string => n !== null),
    chaptersCount: count ? asNumber(count.uploaded) : null,
  };
}

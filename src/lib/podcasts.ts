import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { getCachedJson } from '@/lib/cache/apiCache';
import { wordSearchFilter } from '@/lib/indexSearch';
import { signPodcastAudioUrl } from '@/lib/extract/proxy';
import { XMLParser } from 'fast-xml-parser';
import { XML_ENTITY_OPTIONS } from '@/lib/xmlLimits';
import { vlessDispatcher } from '@/lib/net/vlessProxy';

/**
 * Подкасты. Источников два, и оба — «как в фильмах»: у себя мы держим только
 * идентификаторы и лёгкие метаданные, тяжёлый контент (эпизоды, аудио) живёт у
 * первоисточника.
 *
 *   • iTunes Search API — каталог и поиск. Отдаёт collectionId (наш внешний
 *     id, он же shikimori_id), название, автора, обложку, жанр, страну. По
 *     нему же берём feedUrl.
 *   • RSS самого подкаста — полный список эпизодов. Читаем НА ЛЕТУ и в
 *     память, в базу эпизоды не пишем: у популярного шоу их сотни, а у нас
 *     2ГБ RAM на VPS.
 *
 * Аудио не хостим, но раздаём через свой /api/proxy/raw (подписанная ссылка,
 * см. lib/extract/proxy.ts): часть фидов отдаёт http, а страница у нас https —
 * браузер такие запросы блокирует (mixed content), плюс не все CDN пускают
 * хотлинк. Прокси уже умеет Range/206 и потоковую отдачу, так что перемотка
 * работает, а диск не занимается ни на байт.
 *
 * Свой каталог (podcast_index) заполняет ночной крон: iTunes Search по
 * регионам, батчами. Поиск по нему — один SQL-запрос с триграммами, как у
 * аниме/кино (миграция 0034), поэтому «реализация ии» находит совпадения по
 * подстроке, а не только по точному слову.
 */

// Типы и список регионов живут в podcastShared.ts: их импортируют и
// клиентские компоненты, а этот модуль тянет Supabase и next/headers.
// Реэкспорт — чтобы у серверных страниц остался один путь импорта.
export {
  DEFAULT_PODCAST_REGION,
  PODCAST_REGIONS,
  PODCAST_REGION_COOKIE,
  normalizeRegion,
  regionLabel,
} from '@/lib/podcastShared';
export type { PodcastDetails, PodcastEpisode, PodcastRegion, PodcastSummary } from '@/lib/podcastShared';
import {
  DEFAULT_PODCAST_REGION,
  normalizeRegion,
  type PodcastDetails,
  type PodcastEpisode,
  type PodcastRegion,
  type PodcastSummary,
} from '@/lib/podcastShared';

// ─────────────────────────── Константы источника ───────────────────────────

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const USER_AGENT = 'MediaWatch/1.0 (+podcasts; contact: site admin)';

/** Обложка iTunes приходит с суффиксом размера — меняем на крупный. */
function upscaleArtwork(url: string | null | undefined, px = 600): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${px}x${px}bb.$1`);
}

// ─────────────────────────── Разбор ответов iTunes ───────────────────────────

interface ItunesPodcastResult {
  wrapperType?: string;
  kind?: string;
  collectionId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  primaryGenreName?: string;
  trackCount?: number;
  country?: string;
  collectionViewUrl?: string;
  trackViewUrl?: string;
}

function toSummary(r: ItunesPodcastResult, country: string | null): PodcastSummary | null {
  const id = Number(r.collectionId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    title: r.collectionName ?? r.trackName ?? 'Без названия',
    author: r.artistName ?? '',
    artworkUrl: upscaleArtwork(r.artworkUrl600 ?? r.artworkUrl100 ?? r.artworkUrl60),
    genre: r.primaryGenreName ?? null,
    country: normalizeRegion(r.country ?? country ?? null),
    language: null,
    episodeCount:
      typeof r.trackCount === 'number' && Number.isFinite(r.trackCount) ? r.trackCount : null,
  };
}

/**
 * Живой поиск в iTunes. Регион — обязательный параметр: один и тот же запрос
 * в разных странах отдаёт разные шоу, и «все регионы сразу» iTunes не умеет.
 * Параллельно бьём по нескольким выбранным регионам (см. searchPodcastsLive),
 * а одиночный запрос оставлен для точных сценариев.
 */
export async function searchPodcastsLive(
  query: string,
  regions: PodcastRegion[],
  perRegion = 25,
): Promise<PodcastSummary[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const effective = regions.length > 0 ? regions : [DEFAULT_PODCAST_REGION];

  const results = await Promise.all(
    effective.map(async (region) => {
      try {
        return await getCachedJson<PodcastSummary[]>(
          `podcast:search:${region}:${term.toLowerCase()}:${perRegion}`,
          60 * 60,
          async () => {
            const params = new URLSearchParams({
              media: 'podcast',
              entity: 'podcast',
              term,
              country: region,
              limit: String(perRegion),
            });
            const json = await fetchJson(`${ITUNES_SEARCH}?${params}`);
            const items = (json.results ?? []) as ItunesPodcastResult[];
            return items
              .map((r) => toSummary(r, region))
              .filter((s): s is PodcastSummary => s !== null);
          },
        );
      } catch (err) {
        console.error(
          `[podcasts] поиск iTunes ${region} не удался:`,
          err instanceof Error ? err.message : err,
        );
        return [];
      }
    }),
  );

  // Дедуп по id: одно и то же шоу всплывает в нескольких регионах.
  const byId = new Map<number, PodcastSummary>();
  for (const list of results) {
    for (const item of list) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

/** Метаданные одного подкаста по collectionId (включая feedUrl). */
export async function lookupPodcast(id: number): Promise<PodcastSummary | null> {
  const row = await getCachedJson<ItunesPodcastResult | null>(
    `podcast:lookup:${id}`,
    6 * 60 * 60,
    async () => {
      const json = await fetchJson(`${ITUNES_LOOKUP}?id=${id}`);
      const items = (json.results ?? []) as ItunesPodcastResult[];
      return items[0] ?? null;
    },
  );
  return row ? toSummary(row, row.country ?? null) : null;
}

/** feedUrl отдельно от Summary (в карточку он не нужен, а в кэш меты — да). */
async function lookupFeedUrl(id: number): Promise<{ feedUrl: string | null; appleUrl: string | null }> {
  return getCachedJson(`podcast:feedurl:${id}`, 6 * 60 * 60, async () => {
    const json = await fetchJson(`${ITUNES_LOOKUP}?id=${id}`);
    const items = (json.results ?? []) as ItunesPodcastResult[];
    const row = items[0];
    return {
      feedUrl: row?.feedUrl ?? null,
      appleUrl: row?.collectionViewUrl ?? row?.trackViewUrl ?? null,
    };
  });
}

async function fetchJson(url: string): Promise<{ results?: unknown[] }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  return (await res.json()) as { results?: unknown[] };
}

// ─────────────────────────── Разбор RSS ───────────────────────────

/** Разбираем без value-парсинга: приходит куча дат и номеров в неожиданных
 *  форматах, приведение строк надёжнее, чем доверие эвристике парсера. */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  // item — всегда массив, даже если он в фиде один.
  isArray: (name) => name === 'item',
  // Лимит раскрытий сущностей поднят — см. lib/xmlLimits.ts.
  processEntities: XML_ENTITY_OPTIONS,
});

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value.filter((v): v is XmlNode => typeof v === 'object' && v !== null);
  if (value && typeof value === 'object') return [value as XmlNode];
  return [];
}

/** Текст из узла: строка, число или {#text} — что бы ни подсунул парсер. */
function asText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = asText(v);
      if (t) return t;
    }
    return '';
  }
  if (typeof value === 'object') {
    const node = value as XmlNode;
    if ('#text' in node) return asText(node['#text']);
  }
  return '';
}

function attr(node: unknown, name: string): string {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const v = (node as XmlNode)[name];
    if (typeof v === 'string') return v.trim();
  }
  return '';
}

/** Убираем теги и разворачиваем основные сущности — описания в фидах это HTML. */
export function stripHtml(raw: string): string {
  if (!raw) return '';
  // Переносы строк сохраняем: описание выпуска показывается целиком
  // (whitespace-pre-line), и склеенное в одну строку оно читалось сплошной
  // стеной текста — у подкастов это обычно абзацы и списки тем.
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** itunes:duration — либо секунды, либо «[ч:]мм:сс». */
function parseDuration(value: unknown): number {
  const text = asText(value);
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function parseDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const t = Date.parse(text);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

interface ParsedFeed {
  title: string | null;
  description: string | null;
  language: string | null;
  imageUrl: string | null;
  episodes: PodcastEpisode[];
}

/**
 * Полный разбор RSS-фида в эпизоды. Хронологический порядок (старые первыми):
 * index — это позиция в отсортированном списке, поэтому подкаст, вышедший
 * сегодня, не сдвинет номера уже вышедших.
 */
export function parsePodcastFeed(xml: string): ParsedFeed {
  const parsed = xmlParser.parse(xml) as XmlNode;
  const rss = parsed?.rss as XmlNode | undefined;
  const channel = (rss?.channel ?? parsed?.channel) as XmlNode | undefined;
  if (!channel) throw new Error('в фиде нет channel');

  const channelImage =
    attr(channel['itunes:image'], '@_href') ||
    asText((channel.image as XmlNode | undefined)?.url) ||
    null;

  const items = asArray(channel.item);
  const raw: (PodcastEpisode & { sortKey: number })[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const enclosure = item.enclosure;
    const audioUrl =
      attr(enclosure, '@_url') ||
      attr(item['media:content'], '@_url') ||
      attr(asArray(item['media:content'])[0], '@_url');
    if (!audioUrl) continue;

    const guid = asText(item.guid) || asText(item['podcast:guid']) || audioUrl;
    // Некоторые фиды дублируют эпизод; дедуп по guid, иначе по ссылке.
    const dedupKey = `${guid}|${audioUrl}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const description =
      stripHtml(asText(item['content:encoded'])) ||
      stripHtml(asText(item['itunes:summary'])) ||
      stripHtml(asText(item.description)) ||
      null;

    const durationSeconds =
      parseDuration(item['itunes:duration']) ||
      // Некоторые фиды дают только размер файла — не гадаем с битрейтом,
      // честнее показать 0 («длительность неизвестна»).
      0;

    const publishedAt = parseDate(item.pubDate) ?? parseDate(item['itunes:releaseDate']);
    const parsedDate = publishedAt ? Date.parse(publishedAt) : Number.MAX_SAFE_INTEGER;

    raw.push({
      index: 0,
      title: asText(item.title) || asText(item['itunes:title']) || 'Без названия',
      description,
      audioUrl,
      durationSeconds,
      imageUrl: attr(item['itunes:image'], '@_href') || channelImage,
      publishedAt,
      guid,
      sortKey: parsedDate,
    });
  }

  // Стабильная сортировка: без даты — в конец, в исходном порядке фида.
  raw.sort((a, b) => a.sortKey - b.sortKey);
  const episodes: PodcastEpisode[] = raw.map((e, i) => {
    const { sortKey: _sortKey, ...rest } = e;
    void _sortKey;
    return { ...rest, index: i + 1 };
  });

  return {
    title: asText(channel.title) || null,
    description:
      stripHtml(asText(channel.description)) || stripHtml(asText(channel['itunes:summary'])) || null,
    language: asText(channel.language) || null,
    imageUrl: channelImage,
    episodes,
  };
}

/**
 * Разбор фида по collectionId, целиком — эпизоды и метаданные канала разом.
 *
 * Кэш на 30 минут, и он ОБЯЗАТЕЛЕН: у крупного шоу фид весит ~1.5 МБ, и
 * парсить его на каждый заход дорого. Кэшируем результат парсинга (готовый
 * JSON), а не сам XML — повторный разбор не нужен.
 *
 * Эпизоды и канал берём одним запросом и одним кэшем намеренно: страница
 * подкаста показывает и то, и другое, а два отдельных кэша означали бы два
 * скачивания одного и того же фида (и, из-за 20-секундных таймаутов, вдвое
 * больший шанс, что хотя бы один не успеет).
 */
async function parseFeedCached(
  id: number,
  feedUrl: string,
): Promise<{ episodes: PodcastEpisode[]; description: string | null; language: string | null; imageUrl: string | null }> {
  try {
    return await getCachedJson(
      `podcast:feed:${id}`,
      30 * 60,
      async () => {
        const init = {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/rss+xml, application/xml, text/xml, */*',
          },
          cache: 'no-store' as const,
        };
        // Сначала напрямую, при сетевой ошибке или 403/451 — через VLESS-
        // туннель (см. lib/net/vlessProxy.ts). Часть фидов закрыта для
        // российского IP продакшен-VPS (проверено с VPS 23.10.2026):
        // svoboda.org не устанавливает TCP вовсе, anchor.fm (Spotify) отвечает
        // 403 от Varnish на любой User-Agent, а через туннель оба отдают 200.
        // Всё подряд через туннель не гоняем: большинство фидов доступно и так.
        const viaTunnel = () =>
          fetch(feedUrl, {
            ...init,
            signal: AbortSignal.timeout(20_000),
            // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
            dispatcher: vlessDispatcher(),
          });
        let res: Response;
        try {
          res = await fetch(feedUrl, { ...init, signal: AbortSignal.timeout(20_000) });
          if (res.status === 403 || res.status === 451) res = await viaTunnel();
        } catch {
          res = await viaTunnel();
        }
        if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
        const feed = parsePodcastFeed(await res.text());
        return {
          episodes: feed.episodes,
          description: feed.description,
          language: feed.language,
          imageUrl: feed.imageUrl,
        };
      },
    );
  } catch (err) {
    console.error(`[podcasts] фид ${id} не разобрался:`, err instanceof Error ? err.message : err);
    return { episodes: [], description: null, language: null, imageUrl: null };
  }
}

/** Эпизоды по collectionId: обёртка над общим разбором фида. */
export async function getPodcastEpisodes(id: number, feedUrl: string): Promise<PodcastEpisode[]> {
  if (!feedUrl) return [];
  return (await parseFeedCached(id, feedUrl)).episodes;
}

// ─────────────────────────── Сборка детальной карточки ───────────────────────────

export async function getPodcastDetails(id: number): Promise<PodcastDetails | null> {
  const summary = await lookupPodcast(id);
  if (!summary) return null;

  const { feedUrl, appleUrl } = await lookupFeedUrl(id);
  if (!feedUrl) {
    return {
      ...summary,
      description: null,
      feedUrl: '',
      appleUrl,
      episodes: [],
      episodesUnavailable: true,
    };
  }

  const feed = await parseFeedCached(id, feedUrl);

  return {
    ...summary,
    // Язык канала уточняем из фида — iTunes его отдельным полем не отдаёт.
    language: summary.language ?? feed.language,
    description: feed.description,
    feedUrl,
    appleUrl,
    episodes: feed.episodes,
    episodesUnavailable: feed.episodes.length === 0,
  };
}

// ─────────────────────────── Каталог из индекса ───────────────────────────

/**
 * Чтение каталога подкастов из podcast_index (см. миграцию 0052). Поиск —
 * триграммами, как у аниме (миграция 0034): пользователь вводит «реализация
 * ии», и мы находим совпадения по подстроке в названии и авторе.
 *
 * Никогда не бросает: нет таблицы/упал Supabase — возвращаем пусто, и
 * страница откатывается на живой поиск iTunes (см. searchPodcastsLive).
 */
export interface PodcastCatalogParams {
  query?: string;
  region?: PodcastRegion | null;
  page?: number;
  pageSize?: number;
  sort?: 'popular' | 'new';
}

export async function getPodcastCatalog(
  params: PodcastCatalogParams,
): Promise<{ items: PodcastSummary[]; total: number }> {
  const { query = '', region = null, page = 1, pageSize = 24, sort = 'popular' } = params;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    const supabase = createClient();
    let q = supabase
      .from('podcast_index')
      .select(
        'collection_id, title, author, artwork_original, genre, country, language, episode_count',
        { count: 'exact' },
      )
      .eq('batch_id', await activePodcastBatch(supabase));

    const term = query.trim();
    if (term) {
      // По словам, в любом порядке (см. lib/indexSearch.ts).
      const filter = wordSearchFilter(term, ['title', 'author']);
      if (filter) q = q.or(filter);
    }
    if (region) q = q.eq('country', region);

    q =
      sort === 'new'
        ? q.order('released_at', { ascending: false, nullsFirst: false })
        : q.order('rank', { ascending: true, nullsFirst: false });

    const { data, count, error } = await q.range(from, to);
    if (error) throw new Error(error.message);

    const items = (data ?? []).map((r) => rowToSummary(r as PodcastIndexRow));
    return { items, total: count ?? items.length };
  } catch (err) {
    console.error('[podcasts] чтение каталога не удалось:', err instanceof Error ? err.message : err);
    return { items: [], total: 0 };
  }
}

interface PodcastIndexRow {
  collection_id: number;
  title: string;
  author: string | null;
  artwork_original: string | null;
  genre: string | null;
  country: string | null;
  language: string | null;
  episode_count: number | null;
}

function rowToSummary(r: PodcastIndexRow): PodcastSummary {
  return {
    id: Number(r.collection_id),
    title: r.title,
    author: r.author ?? '',
    artworkUrl: r.artwork_original,
    genre: r.genre,
    country: normalizeRegion(r.country),
    language: r.language,
    episodeCount: r.episode_count,
  };
}

async function activePodcastBatch(
  supabase: ReturnType<typeof createClient>,
): Promise<string> {
  const { data } = await supabase
    .from('podcast_index_state')
    .select('active_batch')
    .eq('id', true)
    .maybeSingle();
  return (data?.active_batch as string | undefined) ?? '00000000-0000-0000-0000-000000000000';
}

/** Подкасты, которые пользователь слушал последними (для «Продолжить»). */
export async function getPodcastSummariesByIds(ids: number[]): Promise<Map<number, PodcastSummary>> {
  const out = new Map<number, PodcastSummary>();
  if (ids.length === 0) return out;
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('podcast_index')
      .select('collection_id, title, author, artwork_original, genre, country, language, episode_count')
      .in('collection_id', ids);
    for (const row of data ?? []) {
      const s = rowToSummary(row as PodcastIndexRow);
      out.set(s.id, s);
    }
  } catch {
    /* нет строки в индексе — карточку соберём из watch_progress */
  }
  return out;
}

// ─────────────────────────── Ссылка Apple Podcasts ───────────────────────────

/**
 * Разбор ссылки вида https://podcasts.apple.com/ru/podcast/.../id1488945593
 * (или просто числа). Возвращает collectionId и, если в ссылке был параметр
 * i=, id конкретного эпизода — он нужен только для сообщения «эпизод ищем»,
 * сопоставить его с фидом надёжно нельзя.
 */
export function parsePodcastLink(input: string): { podcastId: number; episodeId: number | null } | null {
  const value = input.trim();
  if (!value) return null;

  if (/^\d{3,}$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) ? { podcastId: id, episodeId: null } : null;
  }

  const idMatch = value.match(/id(\d{3,})/);
  if (!idMatch) return null;
  const podcastId = Number(idMatch[1]);
  if (!Number.isSafeInteger(podcastId)) return null;

  const epMatch = value.match(/[?&]i=(\d{3,})/);
  const episodeId = epMatch ? Number(epMatch[1]) : null;

  return { podcastId, episodeId: Number.isSafeInteger(episodeId) ? episodeId : null };
}

// ─────────────────────────── Аудио через наш прокси ───────────────────────────

/**
 * Подписанная ссылка на аудио для <audio>. Саму подпись делает серверный
 * модуль прокси: браузер видит только наш /api/proxy/raw, реальный CDN и
 * возможный http-хост наружу не уходят, mixed content не возникает.
 */
export function podcastAudioUrl(audioUrl: string): string {
  // Заголовки (браузерный User-Agent) и запасной путь через туннель задаёт
  // signPodcastAudioUrl: часть аудио-хостингов отказывает Node-клиенту или
  // IP этой VPS.
  return signPodcastAudioUrl(audioUrl);
}

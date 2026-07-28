import type { ExtractParams, ExtractSource } from './types';

/**
 * Список embed-кандидатов источника — без Puppeteer (только сходить в
 * Yummy/собрать URL по шаблону), см. §12.6 ARCHITECTURE.md. Возвращает
 * ГОТОВЫЕ пути зеркала (/api/proxy/mirror/...), а не сырые URL источника —
 * клиент никогда не видит настоящий домен Alloha/Videoseed и не может
 * повлиять на то, что попадёт в запрос к зеркалу.
 */

const YUMMY_BASE = 'https://api.yani.tv';
/** Не перебираем весь список бесконечно — типично 2-4 разных Alloha-эмбеда на серию. */
const MAX_CANDIDATES = 4;

interface YummyVideoItem {
  video_id: number;
  iframe_url: string;
  number: string;
  data?: { dubbing?: string; player?: string };
}

function toMirrorPath(source: ExtractSource, rawUrl: string): string | null {
  const candidate = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  return `/api/proxy/mirror/${source}${parsed.pathname}${parsed.search}`;
}

/**
 * Все Alloha-эмбеды для серии, deduped по iframe_url — Yummy отдаёт одну и ту
 * же озвучку под разными студиями с одинаковым embed, и наоборот, разные
 * озвучки нередко ведут на РАЗНЫЕ Alloha-эмбеды — поэтому один "мёртвый"
 * вариант не должен хоронить весь источник, если рядом есть рабочий (перенос
 * из старого src/lib/extract/alloha.ts, механизм не изменился).
 */
async function getAllohaEmbedPaths(shikimoriId: number, episode: number): Promise<string[]> {
  const listRes = await fetch(`${YUMMY_BASE}/anime?shikimori_ids=${shikimoriId}&limit=1`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!listRes.ok) return [];
  const listData: { response?: { anime_id: number }[] } = await listRes.json().catch(() => ({}));
  const animeId = listData?.response?.[0]?.anime_id;
  if (!animeId) return [];

  const videosRes = await fetch(`${YUMMY_BASE}/anime/${animeId}/videos`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!videosRes.ok) return [];
  const videosData: { response?: YummyVideoItem[] } = await videosRes.json().catch(() => ({}));

  const items = (videosData?.response ?? []).filter((it) => String(it.number) === String(episode));

  const seen = new Set<string>();
  const paths: string[] = [];
  for (const it of items) {
    const isAlloha =
      it.data?.player?.toLowerCase().includes('alloha') ||
      it.iframe_url?.toLowerCase().includes('alloha');
    if (!isAlloha || !it.iframe_url || seen.has(it.iframe_url)) continue;
    seen.add(it.iframe_url);
    const mirrorPath = toMirrorPath('alloha', it.iframe_url);
    if (mirrorPath) paths.push(mirrorPath);
  }
  return paths.slice(0, MAX_CANDIDATES);
}

function videoseedHost(): string {
  return process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net';
}

/** Собирает embed Videoseed по шаблону (перенос из videoseed.ts, механизм не изменился). */
function getVideoseedEmbedPaths(kinopoiskId: number, season: number, episode: number): string[] {
  const token = process.env.VIDEOSEED_TOKEN;
  if (!token) return [];
  const url = new URL(`https://${videoseedHost()}/embed_auto/${kinopoiskId}/`);
  url.searchParams.set('token', token);
  url.searchParams.set('video', `s${season || 1}v${episode}`);
  const mirrorPath = toMirrorPath('videoseed', url.toString());
  return mirrorPath ? [mirrorPath] : [];
}

/** Пути зеркала для всех embed-кандидатов источника — пустой массив, если источник недоступен. */
export async function getEmbedMirrorPaths(
  source: ExtractSource,
  { shikimoriId, season, episode }: ExtractParams,
): Promise<string[]> {
  switch (source) {
    case 'alloha':
      return getAllohaEmbedPaths(shikimoriId, episode);
    case 'videoseed':
      return getVideoseedEmbedPaths(shikimoriId, season, episode);
  }
}

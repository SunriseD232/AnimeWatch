import { launchBrowser } from './browser';
import type { ExtractParams, ResolvedStream } from './types';

/**
 * Извлечение прямой видео-ссылки из Alloha (через embed YummyAnime) —
 * механизм 1:1 перенесён из старого telegram-bot/src/extractors/alloha.ts:
 * там он использовался, чтобы скачать файл и переслать в Telegram; здесь —
 * чтобы сразу проксировать байты в собственный плеер сайта, без Telegram.
 *
 * Алгоритм:
 * 1. YummyAnime API → iframe_url эмбед-плеера Alloha для серии.
 * 2. Открываем iframe_url в headless Chromium, перехватываем сетевые
 *    запросы, ждём появления .mp4/.m3u8.
 * 3. Возвращаем URL + Referer, с которым Alloha его отдаёт (хотлинк-защита).
 */

const YUMMY_BASE = 'https://api.yani.tv';
const REFERER = 'https://yani.tv/';

interface YummyVideoItem {
  video_id: number;
  iframe_url: string;
  number: string;
  data?: { dubbing?: string; player?: string };
}

async function getYummyIframeUrl(
  shikimoriId: number,
  episode: number,
): Promise<string | null> {
  const listRes = await fetch(
    `${YUMMY_BASE}/anime?shikimori_ids=${shikimoriId}&limit=1`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
  );
  if (!listRes.ok) return null;
  const listData: { response?: { anime_id: number }[] } = await listRes
    .json()
    .catch(() => ({}));
  const animeId = listData?.response?.[0]?.anime_id;
  if (!animeId) return null;

  const videosRes = await fetch(`${YUMMY_BASE}/anime/${animeId}/videos`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!videosRes.ok) return null;
  const videosData: { response?: YummyVideoItem[] } = await videosRes
    .json()
    .catch(() => ({}));

  const items = (videosData?.response ?? []).filter(
    (it) => String(it.number) === String(episode),
  );
  if (items.length === 0) return null;

  // Yummy возвращает Kodik/Alloha/Sibnet/Aksor вперемешку — берём именно Alloha.
  const allohaItem = items.find(
    (it) =>
      it.data?.player?.toLowerCase().includes('alloha') ||
      it.iframe_url.toLowerCase().includes('alloha'),
  );
  const url = allohaItem?.iframe_url ?? items[0]?.iframe_url ?? null;
  if (url?.toLowerCase().includes('kodik')) return null; // Kodik — отдельный источник
  return url;
}

async function interceptVideoUrl(embedUrl: string): Promise<string | null> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const videoUrls: string[] = [];

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('.mp4') ||
        url.includes('.m3u8') ||
        url.includes('.ts?') ||
        url.includes('playlist.m3u8') ||
        url.includes('master.m3u8')
      ) {
        videoUrls.push(url);
      }
      request.continue();
    });

    await page.setExtraHTTPHeaders({ Referer: REFERER });
    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 5_000));
    await page.close();

    const mp4 = videoUrls.find((u) => u.includes('.mp4'));
    const m3u8 = videoUrls.find((u) => u.includes('.m3u8') || u.includes('playlist'));
    return mp4 || m3u8 || videoUrls[0] || null;
  } finally {
    await browser.close();
  }
}

export async function extractAlloha({
  shikimoriId,
  episode,
}: ExtractParams): Promise<ResolvedStream | null> {
  const embedUrl = await getYummyIframeUrl(shikimoriId, episode);
  if (!embedUrl) return null;

  const url = await interceptVideoUrl(embedUrl);
  if (!url) return null;

  return { url, headers: { Referer: REFERER }, isHls: url.includes('.m3u8') };
}

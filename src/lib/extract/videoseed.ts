import { launchBrowser } from './browser';
import type { ExtractParams, ResolvedStream } from './types';

/**
 * Извлечение прямой видео-ссылки из Videoseed — перенос механизма из
 * старого telegram-bot/src/extractors/videoseed.ts: раньше перехваченный
 * URL уходил в ffmpeg → Telegram, теперь его напрямую проксирует
 * /api/proxy в собственный плеер сайта.
 */

function videoseedHost(): string {
  return process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net';
}

function buildEmbedUrl(kinopoiskId: number, season: number, episode: number): string | null {
  const token = process.env.VIDEOSEED_TOKEN;
  if (!token) return null;
  const url = new URL(`https://${videoseedHost()}/embed_auto/${kinopoiskId}/`);
  url.searchParams.set('token', token);
  url.searchParams.set('video', `s${season || 1}v${episode}`);
  return url.toString();
}

async function interceptVideoUrl(embedUrl: string, referer: string): Promise<string | null> {
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
        url.includes('playlist.m3u8') ||
        url.includes('master.m3u8') ||
        url.includes('.ts?') ||
        url.includes('/video/') ||
        url.includes('/stream/') ||
        url.includes('/hls/')
      ) {
        videoUrls.push(url);
      }
      request.continue();
    });

    await page.setExtraHTTPHeaders({ Referer: referer });
    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 5_000));
    await page.close();

    const mp4 = videoUrls.find((u) => u.includes('.mp4'));
    const m3u8 = videoUrls.find((u) => u.includes('.m3u8') || u.includes('playlist'));
    const stream = videoUrls.find(
      (u) => u.includes('/video/') || u.includes('/stream/') || u.includes('/hls/'),
    );
    return mp4 || m3u8 || stream || videoUrls[0] || null;
  } finally {
    await browser.close();
  }
}

export async function extractVideoseed({
  shikimoriId,
  season,
  episode,
}: ExtractParams): Promise<ResolvedStream | null> {
  const embedUrl = buildEmbedUrl(shikimoriId, season, episode);
  if (!embedUrl) return null;

  const referer = `https://${videoseedHost()}/`;
  const url = await interceptVideoUrl(embedUrl, referer);
  if (!url) return null;

  return { url, headers: { Referer: referer }, isHls: url.includes('.m3u8') };
}

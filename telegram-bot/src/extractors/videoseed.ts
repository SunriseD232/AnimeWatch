/**
 * Извлечение видео из Videoseed через Puppeteer.
 *
 * Алгоритм:
 * 1. Строим embed URL по kinopoisk_id + сезон + серия + токен
 * 2. Открываем embed URL в Puppeteer
 * 3. Перехватываем сетевой запрос к .mp4 или .m3u8
 * 4. Извлекаем прямую видео-ссылку
 */

import puppeteer from 'puppeteer';

function videoseedHost(): string {
  return process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net';
}

/**
 * Строит embed URL Videoseed (как в src/lib/video/videoseed.ts).
 */
function buildEmbedUrl(
  kinopoiskId: number,
  season: number,
  episode: number,
): string | null {
  const token = process.env.VIDEOSEED_TOKEN;
  if (!token) {
    console.log('[videoseed] VIDEOSEED_TOKEN не задан');
    return null;
  }

  const url = new URL(`https://${videoseedHost()}/embed_auto/${kinopoiskId}/`);
  url.searchParams.set('token', token);
  url.searchParams.set('video', `s${season || 1}v${episode}`);

  return url.toString();
}

/**
 * Открывает embed Videoseed в Puppeteer и перехватывает видео-запрос.
 */
async function extractVideoFromEmbed(
  embedUrl: string,
): Promise<string | null> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();

    const videoUrls: string[] = [];

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();

      // Videoseed может использовать HLS (m3u8) или прямое MP4.
      if (
        url.includes('.mp4') ||
        url.includes('.m3u8') ||
        url.includes('playlist.m3u8') ||
        url.includes('master.m3u8') ||
        url.includes('.ts?') ||
        // Некоторые плееры Videoseed используют свои CDN с .mp4 в пути
        url.includes('/video/') ||
        url.includes('/stream/') ||
        url.includes('/hls/')
      ) {
        videoUrls.push(url);
        console.log(`[puppeteer/videoseed] Найден запрос: ${url.slice(0, 120)}...`);
      }

      request.continue();
    });

    // Устанавливаем referer для Videoseed.
    await page.setExtraHTTPHeaders({
      Referer: `https://${videoseedHost()}/`,
    });

    await page.goto(embedUrl, {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    });

    // Ждём загрузки плеера и начала буферизации.
    await new Promise((r) => setTimeout(r, 5_000));

    await page.close();

    // Находим видео-ссылку.
    const mp4 = videoUrls.find((u) => u.includes('.mp4'));
    const m3u8 = videoUrls.find(
      (u) => u.includes('.m3u8') || u.includes('playlist'),
    );
    const stream = videoUrls.find(
      (u) => u.includes('/video/') || u.includes('/stream/') || u.includes('/hls/'),
    );

    return mp4 || m3u8 || stream || videoUrls[0] || null;
  } catch (err) {
    console.error('[puppeteer/videoseed] Ошибка:', err);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Извлекает прямую видео-ссылку из Videoseed.
 * kinopoiskId — для cinema это shikimori_id (поле общее).
 */
export async function extractVideoseed(
  kinopoiskId: number,
  season: number,
  episode: number,
): Promise<string | null> {
  console.log(`[videoseed] Поиск video для kp ${kinopoiskId} s${season}e${episode}...`);

  const embedUrl = buildEmbedUrl(kinopoiskId, season, episode);
  if (!embedUrl) {
    console.log('[videoseed] embed URL не построен (нет токена?)');
    return null;
  }

  console.log(`[videoseed] Embed URL: ${embedUrl.slice(0, 120)}...`);

  const videoUrl = await extractVideoFromEmbed(embedUrl);
  return videoUrl;
}

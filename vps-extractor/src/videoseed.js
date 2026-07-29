'use strict';

const { toAbsoluteUrl, launchBrowser } = require('./browser');

function videoseedHost() {
  return process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net';
}

function buildEmbedUrl(kinopoiskId, season, episode) {
  const token = process.env.VIDEOSEED_TOKEN;
  if (!token) return null;
  const url = new URL(`https://${videoseedHost()}/embed_auto/${kinopoiskId}/`);
  url.searchParams.set('token', token);
  url.searchParams.set('video', `s${season || 1}v${episode}`);
  return url.toString();
}

async function interceptVideoUrl(rawEmbedUrl, referer) {
  const embedUrl = toAbsoluteUrl(rawEmbedUrl);
  if (!embedUrl) {
    console.error(`[videoseed] Собранный embed URL невалиден: ${rawEmbedUrl}`);
    return null;
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const videoUrls = [];

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
      request.continue().catch(() => {});
    });

    await page.setExtraHTTPHeaders({ Referer: referer });
    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 5_000));
    await page.close();

    const mp4 = videoUrls.find((u) => u.includes('.mp4'));
    const m3u8 = videoUrls.find((u) => u.includes('.m3u8') || u.includes('playlist'));
    const stream = videoUrls.find((u) => u.includes('/video/') || u.includes('/stream/') || u.includes('/hls/'));
    return mp4 || m3u8 || stream || videoUrls[0] || null;
  } catch (err) {
    console.error('[videoseed] Puppeteer упал:', err);
    return null;
  } finally {
    await browser.close();
  }
}

async function extractVideoseed({ shikimoriId, season, episode }) {
  const embedUrl = buildEmbedUrl(shikimoriId, season, episode);
  if (!embedUrl) return null;

  const referer = `https://${videoseedHost()}/`;
  const url = await interceptVideoUrl(embedUrl, referer);
  if (!url) return null;

  return { url, headers: { Referer: referer }, isHls: url.includes('.m3u8') };
}

module.exports = { extractVideoseed };

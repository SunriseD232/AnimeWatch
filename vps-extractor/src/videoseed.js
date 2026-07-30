'use strict';

const { toAbsoluteUrl, launchBrowser } = require('./browser');

/**
 * embed_auto/{id} требует Sec-Fetch-Dest: iframe (браузер выставляет это
 * только при навигации ВНУТРИ iframe, не на верхнем уровне) — тот же класс
 * защиты, что и /bnsi/ у Alloha. Прямой page.goto(embedUrl) навигацией
 * верхнего уровня даёт Sec-Fetch-Dest: document и получает отказ. Поэтому
 * используем тот же приём обёртки, что и в alloha.js: синтетическая
 * страница с <iframe src=embedUrl>, перехваченная через request
 * interception (реальный сетевой запрос на WRAPPER_URL не уходит).
 */
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

  const wrapperUrl = `https://${videoseedHost()}/__mediawatch_wrapper__`;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const videoUrls = [];
    const allUrls = [];

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url === wrapperUrl) {
        request
          .respond({
            status: 200,
            contentType: 'text/html',
            body: `<!DOCTYPE html><html><body style="margin:0"><iframe src="${embedUrl}" style="width:1280px;height:720px;border:0" allow="autoplay"></iframe></body></html>`,
          })
          .catch(() => {});
        return;
      }
      allUrls.push(url);
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
    await page.goto(wrapperUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 2_000));
    // Первый клик закрывает preroll-рекламу (code.21wiz.com), второй
    // реально стартует плеер — подтверждено вручную (diag.js), см. коммит.
    await page.mouse.click(640, 360).catch(() => {});
    await new Promise((r) => setTimeout(r, 4_000));
    await page.mouse.click(640, 360).catch(() => {});
    await new Promise((r) => setTimeout(r, 6_000));
    await page.close();

    if (videoUrls.length === 0) {
      console.error(
        `[videoseed] ${embedUrl}: 0 видео-URL. Запросов всего: ${allUrls.length}. Последние 8: ${JSON.stringify(allUrls.slice(-8))}`,
      );
    }

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

async function extractVideoseed({ shikimoriId, season, episode, embedUrl }) {
  // embedUrl — конкретная озвучка (embed/embed_serial с default_audio_id),
  // выбранная на основном сайте, см. getVideoseedOwnPlayerTranslations().
  // Без него — старое поведение: embed_auto по kinopoisk_id (сайт сам решает
  // озвучку по умолчанию).
  const url = embedUrl || buildEmbedUrl(shikimoriId, season, episode);
  if (!url) return null;

  const referer = `https://${videoseedHost()}/`;
  const resultUrl = await interceptVideoUrl(url, referer);
  if (!resultUrl) return null;

  return { url: resultUrl, headers: { Referer: referer }, isHls: resultUrl.includes('.m3u8') };
}

module.exports = { extractVideoseed };

'use strict';

const { toAbsoluteUrl, resolveProxy, launchBrowser } = require('./browser');

/**
 * Извлечение прямой видео-ссылки из Alloha — см. README.md и §12.5/§12.6
 * ARCHITECTURE.md основного репозитория для полной истории расследования.
 *
 * 1. YummyAnime API → все iframe_url Alloha-эмбедов серии (разные озвучки).
 * 2. Синтетическая обёртка с <iframe src=embedUrl> — обходит анти-хотлинк
 *    (window !== window.top), не заменяет реальный гео-блок на /bnsi/.
 * 3. RU-прокси на всю сессию Chromium — без него /bnsi/ отдаёт 404 с любым
 *    IP кроме российского.
 * 4. Перехват сетевых запросов, ждём .mp4/.m3u8.
 */

const YUMMY_BASE = 'https://api.yani.tv';
const REFERER = 'https://yani.tv/';
const WRAPPER_URL = 'https://yani.tv/__mediawatch_wrapper__';
const MAX_CANDIDATES = 4;
const DECOY_HOSTS = ['cdn.plyr.io'];

function getProxyConfig() {
  const server = process.env.ALLOHA_PROXY_SERVER;
  if (!server) return undefined;
  return {
    server,
    username: process.env.ALLOHA_PROXY_USERNAME,
    password: process.env.ALLOHA_PROXY_PASSWORD,
  };
}

async function getAllohaEmbedUrls(shikimoriId, episode) {
  const listRes = await fetch(`${YUMMY_BASE}/anime?shikimori_ids=${shikimoriId}&limit=1`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!listRes.ok) return [];
  const listData = await listRes.json().catch(() => ({}));
  const animeId = listData?.response?.[0]?.anime_id;
  if (!animeId) return [];

  const videosRes = await fetch(`${YUMMY_BASE}/anime/${animeId}/videos`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!videosRes.ok) return [];
  const videosData = await videosRes.json().catch(() => ({}));

  const items = (videosData?.response ?? []).filter((it) => String(it.number) === String(episode));

  const seen = new Set();
  const urls = [];
  for (const it of items) {
    const isAlloha =
      it.data?.player?.toLowerCase().includes('alloha') || it.iframe_url?.toLowerCase().includes('alloha');
    if (!isAlloha || !it.iframe_url || seen.has(it.iframe_url)) continue;
    seen.add(it.iframe_url);
    urls.push(it.iframe_url);
  }
  return urls.slice(0, MAX_CANDIDATES);
}

async function interceptVideoUrl(browser, rawEmbedUrl) {
  const embedUrl = toAbsoluteUrl(rawEmbedUrl);
  if (!embedUrl) {
    console.error(`[alloha] Yummy отдал невалидный iframe_url: ${rawEmbedUrl}`);
    return null;
  }

  const page = await browser.newPage();
  try {
    const videoUrls = [];
    const allUrls = [];
    const bnsiStatuses = [];

    page.on('response', (res) => {
      if (res.url().includes('/bnsi/')) {
        res
          .text()
          .then((t) => bnsiStatuses.push(`${res.status()} ${res.url()} body=${t.slice(0, 200)}`))
          .catch(() => {});
      }
    });

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url === WRAPPER_URL) {
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
        !DECOY_HOSTS.some((host) => url.includes(host)) &&
        (url.includes('.mp4') ||
          url.includes('.m3u8') ||
          url.includes('.ts?') ||
          url.includes('playlist.m3u8') ||
          url.includes('master.m3u8'))
      ) {
        videoUrls.push(url);
      }
      request.continue().catch(() => {});
    });

    await page.setExtraHTTPHeaders({ Referer: REFERER });
    const response = await page.goto(WRAPPER_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
    if (response && !response.ok()) {
      console.error(`[alloha] Обёртка вернула HTTP ${response.status()} — не должно происходить`);
      return null;
    }

    await page.mouse.click(640, 360).catch(() => {});
    await new Promise((r) => setTimeout(r, 5_000));

    if (videoUrls.length === 0) {
      console.error(
        `[alloha] ${embedUrl}: 0 видео-URL. Запросов всего: ${allUrls.length}. Последние 8: ${JSON.stringify(allUrls.slice(-8))}. /bnsi/: ${JSON.stringify(bnsiStatuses)}`,
      );
    }

    const mp4 = videoUrls.find((u) => u.includes('.mp4'));
    const m3u8 = videoUrls.find((u) => u.includes('.m3u8') || u.includes('playlist'));
    return mp4 || m3u8 || videoUrls[0] || null;
  } catch (err) {
    console.error(`[alloha] Puppeteer упал на ${embedUrl}:`, err);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function extractAlloha({ shikimoriId, episode }) {
  const embedUrls = await getAllohaEmbedUrls(shikimoriId, episode);
  console.error(`[alloha] Кандидатов от Yummy: ${embedUrls.length}`);
  if (embedUrls.length === 0) {
    console.error(`[alloha] Yummy не вернул Alloha-эмбед для shikimori ${shikimoriId} ep ${episode}`);
    return null;
  }

  const proxyConfig = getProxyConfig();
  console.error(proxyConfig ? '[alloha] RU-прокси задан' : '[alloha] RU-прокси НЕ задан — работаем напрямую');
  let resolvedProxy = null;
  if (proxyConfig) {
    try {
      resolvedProxy = await resolveProxy(proxyConfig);
      console.error(`[alloha] Прокси-мост поднят: ${resolvedProxy.launchArg}`);
    } catch (err) {
      console.error('[alloha] resolveProxy() упал, работаем без прокси:', err);
    }
  }

  const browser = await launchBrowser(resolvedProxy?.launchArg);
  try {
    for (const embedUrl of embedUrls) {
      const url = await interceptVideoUrl(browser, embedUrl);
      if (url) {
        return { url, headers: { Referer: REFERER }, isHls: url.includes('.m3u8') };
      }
    }
  } finally {
    await browser.close();
    await resolvedProxy?.close().catch(() => {});
  }

  return null;
}

module.exports = { extractAlloha };

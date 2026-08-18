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

/**
 * Прокси-мост (лёгкий локальный анонимайзинг-процесс, не Chromium) держим
 * общим на весь процесс — ALLOHA_PROXY_* статичные env, один и тот же
 * RU-прокси на каждый запрос, пересоздавать его на каждое извлечение смысла
 * нет. А вот САМ БРАУЗЕР теперь — НЕ общий, лаунчим и закрываем на каждое
 * извлечение (см. историю: раньше держали один персистентный Chromium на
 * весь процесс, как у Videoseed, — но на этой VPS всего 1.9GB RAM, и после
 * того как Alloha-путь стал использоваться ещё и для кино (не только аниме
 * через Yummy, см. extractAlloha), два одновременно живущих полных Chromium
 * (Videoseed + Alloha) плюс их подпроцессы (GPU/network/audio/renderer)
 * держали свободную память в районе 170МБ — подтверждённая вживую причина
 * сайт-виде нестабильности при обычной пользовательской нагрузке. Запуск
 * браузера сам по себе дёшев (~0.4-0.9с, см. тот же приём в browser.js),
 * так что жертвуем этим временем ради того, чтобы не держать лишние ~150-
 * 200МБ занятыми, когда Alloha не используется прямо сейчас.
 */
let sharedProxyBridge = null;

async function getAllohaProxyArg() {
  const proxyConfig = getProxyConfig();
  if (!proxyConfig) {
    console.error('[alloha] RU-прокси НЕ задан — работаем напрямую');
    return undefined;
  }
  if (!sharedProxyBridge) {
    try {
      sharedProxyBridge = await resolveProxy(proxyConfig);
      console.error(`[alloha] Прокси-мост поднят (общий, на всё время процесса): ${sharedProxyBridge.launchArg}`);
    } catch (err) {
      console.error('[alloha] resolveProxy() упал, работаем без прокси:', err);
      return undefined;
    }
  }
  return sharedProxyBridge.launchArg;
}

/** Закрытие при штатном завершении процесса — см. server.js. */
async function closeSharedAllohaBrowser() {
  if (sharedProxyBridge) {
    await sharedProxyBridge.close().catch(() => {});
    sharedProxyBridge = null;
  }
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

/** С таймаутом — на этой VPS через RU-прокси evaluate() внутри их плеера
 *  иногда просто зависает (CDP callFunctionOn timeout), лучше отвалиться
 *  быстро, чем повесить всё извлечение. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate timeout')), ms)),
  ]);
}

/**
 * Их плеер (CSS-класс "allplay") сам определяет "auto"-качество при
 * подключении — через наш RU-прокси (общий мост, небольшая пропускная
 * способность) это почти всегда занижено (проверено вживую: 480p вместо
 * реально доступных 2160p/4K). Форсируем через их собственное UI меню
 * настроек — сама структура найдена вручную через живое исследование DOM
 * (см. историю расследования), нигде не задокументирована и может
 * сломаться при обновлении их плеера — поэтому best-effort с fallback:
 * при любой ошибке просто оставляем то качество, что плеер и так выбрал
 * сам (не хуже прежнего поведения).
 *
 * Путь клика: шестерёнка настроек → первая строка меню (Качество) →
 * первый вариант в открывшемся подменю (самое высокое качество — список
 * идёт по убыванию: 2160p/4K, 1440p/2K, 1080p, 720p, 480p, 360p).
 */
async function forceHighestQuality(page, embedOrigin) {
  try {
    const frame = page.frames().find((f) => f.url().startsWith(embedOrigin));
    if (!frame) return;

    await withTimeout(
      frame.evaluate(() => {
        document.querySelector('.allplay__menu > button.allplay__control')?.click();
      }),
      5_000,
    );
    await new Promise((r) => setTimeout(r, 500));

    await withTimeout(
      frame.evaluate(() => {
        const pages = document.querySelectorAll('.allplay__menu__container > div > div');
        pages[0]?.children[0]?.click();
      }),
      5_000,
    );
    await new Promise((r) => setTimeout(r, 500));

    const clicked = await withTimeout(
      frame.evaluate(() => {
        const pages = document.querySelectorAll('.allplay__menu__container > div > div');
        const best = pages[1]?.children[1]?.children[0];
        if (!best) return null;
        const label = best.textContent.trim();
        best.click();
        return label;
      }),
      5_000,
    );
    if (clicked) {
      console.error(`[alloha] Качество переключено на: ${clicked}`);
    } else {
      console.error('[alloha] Меню качества не нашлось — оставляем авто-выбор плеера');
    }
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    console.error('[alloha] Не удалось переключить качество (не критично, используем авто):', err.message);
  }
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

    // Переключаем на максимальное качество ДО старта воспроизведения — их
    // плеер запрашивает master.m3u8 уже под выбранное качество, так что
    // после этого шага играть/ждать нужно только один раз (см. комментарий
    // у forceHighestQuality — почему это best-effort, не гарантия).
    await forceHighestQuality(page, new URL(embedUrl).origin);
    videoUrls.length = 0; // сбрасываем то, что плеер успел запросить под старым (авто) качеством

    await page.mouse.click(640, 360).catch(() => {});
    await new Promise((r) => setTimeout(r, 6_000));

    if (videoUrls.length === 0) {
      console.error(
        `[alloha] ${embedUrl}: 0 видео-URL. Запросов всего: ${allUrls.length}. Последние 8: ${JSON.stringify(allUrls.slice(-8))}. /bnsi/: ${JSON.stringify(bnsiStatuses)}`,
      );
    }

    // Alloha отдаёт фрагментированный CMAF (master.m3u8 → index-*.m3u8 →
    // init-*.mp4 + seg-*.m4s) — init-сегмент сам по себе крошечный (~1КБ,
    // только moov/ftyp) и НЕ играбелен как самостоятельный файл. Поэтому
    // master.m3u8 всегда в приоритете над любым .mp4-совпадением (иначе
    // find() выше отдаёт init-сегмент как "видео").
    const master = videoUrls.find((u) => u.includes('master.m3u8'));
    const anyM3u8 = videoUrls.find((u) => u.includes('.m3u8') || u.includes('playlist'));
    const mp4 = videoUrls.find((u) => u.includes('.mp4') && !u.includes('init-'));
    const videoUrl = master || anyM3u8 || mp4 || videoUrls[0] || null;
    if (!videoUrl) return null;
    return { videoUrl, embedOrigin: new URL(embedUrl).origin };
  } catch (err) {
    console.error(`[alloha] Puppeteer упал на ${embedUrl}:`, err);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function extractAlloha({ shikimoriId, episode, embedUrl: forcedEmbedUrl }) {
  let embedUrls;
  if (forcedEmbedUrl) {
    // Конкретная озвучка уже выбрана на стороне основного приложения (оно
    // само знает список переводов Yummy) — не гадаем среди кандидатов сами.
    embedUrls = [forcedEmbedUrl];
    console.error('[alloha] Используем явно переданный embedUrl (конкретная озвучка)');
  } else {
    embedUrls = await getAllohaEmbedUrls(shikimoriId, episode);
    console.error(`[alloha] Кандидатов от Yummy: ${embedUrls.length}`);
    if (embedUrls.length === 0) {
      console.error(`[alloha] Yummy не вернул Alloha-эмбед для shikimori ${shikimoriId} ep ${episode}`);
      return null;
    }
  }

  // Puppeteer-извлечения (Alloha/Videoseed) уже сериализованы на уровне
  // server.js (см. serialized() там) — здесь просто одно извлечение, без
  // дополнительной очереди.
  const proxyArg = await getAllohaProxyArg();
  const browser = await launchBrowser(proxyArg);
  try {
    for (const embedUrl of embedUrls) {
      const result = await interceptVideoUrl(browser, embedUrl);
      if (result) {
        const { videoUrl, embedOrigin } = result;
        // CDN проверяет Origin/Referer именно эмбед-страницы (alloha.yani.tv),
        // а не внешней обёртки (yani.tv) — иначе отдаёт 403 x-vd:origin_mismatch
        // при последующем проксировании байт с Vercel. См. ARCHITECTURE.md §12.6.
        return {
          url: videoUrl,
          headers: { Referer: `${embedOrigin}/`, Origin: embedOrigin },
          isHls: videoUrl.includes('.m3u8'),
        };
      }
    }
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { extractAlloha, closeSharedAllohaBrowser };

'use strict';

const { toAbsoluteUrl, getSharedBrowser } = require('./browser');

/**
 * Извлечение прямой видео-ссылки из Alloha — см. README.md и §12.5/§12.6
 * ARCHITECTURE.md основного репозитория для полной истории расследования.
 *
 * 1. YummyAnime API → все iframe_url Alloha-эмбедов серии (разные озвучки).
 * 2. Синтетическая обёртка с <iframe src=embedUrl> — обходит анти-хотлинк
 *    (window !== window.top), не заменяет реальный гео-блок на /bnsi/.
 * 3. RU-прокси на трафик Alloha (не на весь браузер — тот теперь общий с
 *    Videoseed, маршрутизация через PAC, см. browser.js) — без прокси
 *    /bnsi/ отдаёт 404 с любым IP кроме российского.
 * 4. Перехват сетевых запросов, ждём .mp4/.m3u8.
 */

const YUMMY_BASE = 'https://api.yani.tv';
const REFERER = 'https://yani.tv/';
const WRAPPER_URL = 'https://yani.tv/__mediawatch_wrapper__';
const MAX_CANDIDATES = 4;
const DECOY_HOSTS = ['cdn.plyr.io'];

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
 * Опрашивает фрейм, пока evaluateFn (чистая DOM-функция, без внешних
 * замыканий — выполняется В СТРАНИЦЕ) не вернёт истинное значение, или до
 * таймаута. Раньше между шагами клика просто спали фиксированные 500мс
 * "на всякий случай" — теперь ждём ровно того, что реально нужно (элемент
 * появился и кликнут), и не дольше. Ускоряет типичный успешный случай,
 * не меняя поведение в худшем (по-прежнему best-effort с fallback).
 */
async function pollFrame(frame, evaluateFn, timeoutMs, intervalMs = 80) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await withTimeout(frame.evaluate(evaluateFn), Math.min(2_000, timeoutMs)).catch(() => undefined);
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
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

    const openedSettings = await pollFrame(
      frame,
      () => {
        const btn = document.querySelector('.allplay__menu > button.allplay__control');
        if (!btn) return false;
        btn.click();
        return true;
      },
      3_000,
    );
    if (!openedSettings) {
      console.error('[alloha] Кнопка настроек не появилась — оставляем авто-выбор плеера');
      return;
    }

    const openedQualitySubmenu = await pollFrame(
      frame,
      () => {
        const pages = document.querySelectorAll('.allplay__menu__container > div > div');
        const row = pages[0] && pages[0].children[0];
        if (!row) return false;
        row.click();
        return true;
      },
      2_000,
    );
    if (!openedQualitySubmenu) {
      console.error('[alloha] Строка "Качество" не появилась — оставляем авто-выбор плеера');
      return;
    }

    const clicked = await pollFrame(
      frame,
      () => {
        const pages = document.querySelectorAll('.allplay__menu__container > div > div');
        const best = pages[1] && pages[1].children[1] && pages[1].children[1].children[0];
        if (!best) return null;
        const label = best.textContent.trim();
        best.click();
        return label;
      },
      2_000,
    );
    if (clicked) {
      console.error(`[alloha] Качество переключено на: ${clicked}`);
    } else {
      console.error('[alloha] Меню качества не нашлось — оставляем авто-выбор плеера');
    }
  } catch (err) {
    console.error('[alloha] Не удалось переключить качество (не критично, используем авто):', err.message);
  }
}

/**
 * Alloha отдаёт фрагментированный CMAF (master.m3u8 → index-*.m3u8 →
 * init-*.mp4 + seg-*.m4s) — init-сегмент сам по себе крошечный (~1КБ,
 * только moov/ftyp) и НЕ играбелен как самостоятельный файл. Поэтому
 * master.m3u8 всегда в приоритете над любым .mp4-совпадением (иначе find()
 * отдаёт init-сегмент как "видео"). Тот же критерий используется и чтобы
 * решить, можно ли уже прекращать опрос (см. hasUsableVideoUrl ниже).
 */
function pickVideoUrl(urls) {
  const master = urls.find((u) => u.includes('master.m3u8'));
  const anyM3u8 = urls.find((u) => u.includes('.m3u8') || u.includes('playlist'));
  const mp4 = urls.find((u) => u.includes('.mp4') && !u.includes('init-'));
  return master || anyM3u8 || mp4 || urls[0] || null;
}

function hasUsableVideoUrl(urls) {
  return pickVideoUrl(urls) !== null;
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
    // Раньше здесь просто спали фиксированные 6с независимо от того, когда
    // реально пришёл нужный запрос — типичный успешный случай (URL приходит
    // за секунду-две) платил за это лишним временем. Опрашиваем вместо
    // этого сам массив videoUrls (его уже пополняет обработчик 'request'
    // выше) и выходим, как только там появится что-то реально пригодное —
    // тот же критерий, что и в выборе videoUrl ниже, а не первое попавшееся
    // совпадение (иначе можно выйти раньше на мусорном decoy-запросе).
    const deadline = Date.now() + 6_000;
    while (!hasUsableVideoUrl(videoUrls) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
    }

    if (videoUrls.length === 0) {
      console.error(
        `[alloha] ${embedUrl}: 0 видео-URL. Запросов всего: ${allUrls.length}. Последние 8: ${JSON.stringify(allUrls.slice(-8))}. /bnsi/: ${JSON.stringify(bnsiStatuses)}`,
      );
    }

    const videoUrl = pickVideoUrl(videoUrls);
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
  // дополнительной очереди. Браузер общий с Videoseed (см. getSharedBrowser
  // в browser.js) — не закрываем его тут, только свою страницу (см. finally
  // в interceptVideoUrl).
  const browser = await getSharedBrowser();
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
}

module.exports = { extractAlloha };

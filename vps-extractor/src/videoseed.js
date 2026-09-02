'use strict';

const { toAbsoluteUrl, getSharedBrowser, serializeBrowserUse } = require('./browser');
const { extractViaHttp } = require('./videoseed-http');
const {
  UA,
  videoseedHost,
  buildEmbedUrl,
  probeQualities,
  subtitleLabel,
  subtitleLangFromUrl,
} = require('./videoseed-shared');

/**
 * embed_auto/{id} требует Sec-Fetch-Dest: iframe (браузер выставляет это
 * только при навигации ВНУТРИ iframe, не на верхнем уровне) — тот же класс
 * защиты, что и /bnsi/ у Alloha. Прямой page.goto(embedUrl) навигацией
 * верхнего уровня даёт Sec-Fetch-Dest: document и получает отказ. Поэтому
 * используем тот же приём обёртки, что и в alloha.js: синтетическая
 * страница с <iframe src=embedUrl>, перехваченная через request
 * interception (реальный сетевой запрос на WRAPPER_URL не уходит).
 *
 * Этот Puppeteer-путь теперь — ЗАПАСНОЙ. Основной (см. extractVideoseed
 * ниже) — videoseed-http.js, без браузера вообще, включая случай с
 * конкретно выбранной озвучкой (сопоставляется по translationLabel, см.
 * videoseed-http.js); сюда попадаем только если HTTP-путь не сработал
 * (сменился формат страницы, не нашли эту озвучку по имени и т.п.).
 */

/**
 * Рекламная сеть на embed-странице (preroll) иногда крутит СВОЙ видеоролик,
 * а не баннер/оверлей — его URL неотличим от настоящего по домену или пути
 * (найдено вживую: оба на edge-*.kinescopecdn.net, одинаковая структура
 * пути). Единственный надёжный сигнал — размер: рекламные ролики виденные
 * вживую — ~1.2МБ на 15с, настоящая серия кратно больше на порядки. Порог
 * с большим запасом, чтобы не отсечь честную серию низкого качества/короткий
 * фрагмент, но отсечь любой правдоподобный рекламный ролик.
 */
const MIN_REAL_VIDEO_BYTES = 15_000_000;

async function probeContentLength(url, referer) {
  try {
    const res = await fetch(url, {
      headers: { Referer: referer, 'User-Agent': UA, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok && res.status !== 206) return null;
    const range = res.headers.get('content-range'); // "bytes 0-0/1220664"
    const total = range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length'));
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

async function isLikelyRealVideo(url, referer) {
  const total = await probeContentLength(url, referer);
  return total !== null && total >= MIN_REAL_VIDEO_BYTES;
}

// Сеть рекламной preroll-вставки на embed-странице (см. клики ниже — раньше
// их приходилось эмулировать именно чтобы закрыть/пройти эту рекламу).
// Блокируем её запросы совсем — не даём ей загрузиться, вместо того чтобы
// ждать/кликать её насквозь.
const AD_HOST_PATTERNS = [/(^|\.)21wiz\.com$/i];

function isAdRequest(url) {
  try {
    return AD_HOST_PATTERNS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

async function interceptVideoUrl(rawEmbedUrl, referer) {
  const embedUrl = toAbsoluteUrl(rawEmbedUrl);
  if (!embedUrl) {
    console.error(`[videoseed] Собранный embed URL невалиден: ${rawEmbedUrl}`);
    return null;
  }

  const wrapperUrl = `https://${videoseedHost()}/__mediawatch_wrapper__`;

  // Общий Chromium-процесс (см. browser.js) — Videoseed не требует
  // per-request прокси, поэтому его браузер можно держать живым между
  // запросами вместо запуска нового процесса на каждое извлечение.
  const browser = await getSharedBrowser();
  let page;
  try {
    page = await browser.newPage();
    const videoUrls = [];
    const subtitleUrls = [];
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
      if (isAdRequest(url)) {
        request.abort().catch(() => {});
        return;
      }
      allUrls.push(url);
      if (/\.vtt(?:[?#]|$)/i.test(url)) {
        if (!subtitleUrls.includes(url)) subtitleUrls.push(url);
      } else if (
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
    await new Promise((r) => setTimeout(r, 500));
    // Клики раньше были нужны, чтобы закрыть preroll-рекламу
    // (code.21wiz.com) — теперь она блокируется на уровне сети (см.
    // isAdRequest выше) и вообще не грузится, поэтому паузы можно держать
    // короткими: клики нужны просто чтобы стартовать сам плеер (жест
    // пользователя для автовоспроизведения), не для дизмисса рекламы.
    // Проверено вживую на нескольких тайтлах — стабильно ~4-6.5с вместо
    // прежних ~10-13с (и ~23с до блокировки рекламы), см. коммит.
    await page.mouse.click(640, 360).catch(() => {});
    await new Promise((r) => setTimeout(r, 1_000));
    await page.mouse.click(640, 360).catch(() => {});

    // Ждём появления НАСТОЯЩЕГО видео, а не просто фиксированную паузу:
    // реклама сама по себе иногда тоже видеоролик (см. коммент ниже), и если
    // она ещё не закрылась ко второму клику, настоящий плеер стартует позже.
    // Проверяем часто (POLL_INTERVAL_MS), выходим раньше при первом же
    // надёжном сигнале:
    //  - m3u8/HLS-манифест — сама реклама на этой странице ни разу не была
    //    HLS (только mp4-видеоролик), так что его появление само по себе
    //    достаточный сигнал, размер проверять незачем;
    //  - mp4 — единственный формат, где реклама неотличима по URL, поэтому
    //    для него нужна проверка размера (см. isLikelyRealVideo).
    const POLL_INTERVAL_MS = 1_500;
    const MAX_POLLS = 10; // тот же суммарный потолок ожидания, что был раньше (~15с)
    const knownBad = new Set();
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const hasManifestOrStream = videoUrls.some(
        (u) =>
          u.includes('.m3u8') ||
          u.includes('playlist') ||
          u.includes('/video/') ||
          u.includes('/stream/') ||
          u.includes('/hls/'),
      );
      if (hasManifestOrStream) break;
      const candidate = [...videoUrls].reverse().find((u) => u.includes('.mp4') && !knownBad.has(u));
      if (!candidate) continue;
      if (await isLikelyRealVideo(candidate, referer)) break;
      knownBad.add(candidate);
    }
    await page.close();

    if (videoUrls.length === 0) {
      console.error(
        `[videoseed] ${embedUrl}: 0 видео-URL. Запросов всего: ${allUrls.length}. Последние 8: ${JSON.stringify(allUrls.slice(-8))}`,
      );
    }

    // Реклама на странице (preroll code.21wiz.com и т.п.) не всегда баннер —
    // иногда сама крутит видеоролик, чей URL неотличим от настоящего домена/
    // пути (найдено вживую: оба на kinescopecdn.net). Поэтому среди
    // mp4-кандидатов (от новых к старым) берём первый, реально прошедший
    // проверку размера, а не первый попавшийся — иначе гарантированно ловим
    // рекламу, если её запрос вообще есть в списке.
    const byRecency = [...videoUrls].reverse();
    const mp4Candidates = byRecency.filter((u) => u.includes('.mp4'));
    let mp4 = null;
    for (const candidate of mp4Candidates) {
      if (await isLikelyRealVideo(candidate, referer)) {
        mp4 = candidate;
        break;
      }
    }
    const m3u8 = byRecency.find((u) => u.includes('.m3u8') || u.includes('playlist'));
    const stream = byRecency.find((u) => u.includes('/video/') || u.includes('/stream/') || u.includes('/hls/'));
    // byRecency[0] как последний резерв — только если среди кандидатов вообще
    // не было mp4 (т.е. это не тот случай рекламного ролика, который мы
    // научились отличать по размеру, а какой-то другой формат URL).
    const videoUrl = mp4 || m3u8 || stream || (mp4Candidates.length === 0 ? byRecency[0] : null) || null;
    if (!videoUrl && mp4Candidates.length > 0) {
      console.error(
        `[videoseed] ${embedUrl}: все ${mp4Candidates.length} mp4-кандидата похожи на рекламу (< ${MIN_REAL_VIDEO_BYTES} байт)`,
      );
    }
    return { videoUrl, subtitleUrls };
  } catch (err) {
    console.error('[videoseed] Puppeteer упал:', err);
    return null;
  } finally {
    // Браузер общий (см. getSharedBrowser) — НЕ закрываем его тут, только
    // свою страницу. page уже закрыта выше в успешном пути; на ветке catch
    // (или раннем throw до этого) она может остаться открытой — закрываем,
    // если ещё не закрыта.
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

/** Запасной Puppeteer-путь — вызывается только когда HTTP-путь не сработал
 *  (см. extractVideoseed ниже). Сериализуется через общий с Alloha браузер
 *  (serializeBrowserUse, browser.js) — только на время ЭТОГО вызова, не на
 *  весь extractVideoseed целиком, чтобы быстрый HTTP-путь никогда не ждал
 *  своей очереди за Alloha. */
async function extractViaPuppeteer({ shikimoriId, season, episode, embedUrl }) {
  const url = embedUrl || buildEmbedUrl(shikimoriId, season, episode);
  if (!url) return null;

  const referer = `https://${videoseedHost()}/`;
  // Изредка первый проход Puppeteer не находит видео-URL вообще (0 запросов
  // с видео — вероятно, клик по плееру не попал в нужный момент рекламного
  // прероллa). Раньше это сразу отдавалось пользователю как "серия
  // недоступна" без единой повторной попытки. Один ретрай — полностью
  // свежий браузер/страница — обычно решает: суммарно два прохода укладываются
  // в районе 30-35с, с запасом от 55с/60с таймаутов по цепочке (vpsExtractor
  // → /api/proxy).
  let intercepted = await interceptVideoUrl(url, referer);
  if (!intercepted?.videoUrl) {
    console.error('[videoseed] Первая попытка не нашла видео — повтор с нуля...');
    intercepted = await interceptVideoUrl(url, referer);
  }
  if (!intercepted?.videoUrl) return null;
  const { videoUrl: resultUrl, subtitleUrls } = intercepted;

  const isHls = resultUrl.includes('.m3u8');
  // Список качеств — best-effort: не находим тиры (нестандартный путь CDN,
  // не .../{H}.mp4:hls:manifest.m3u8) — просто отдаём единственное найденное
  // качество, как раньше.
  const qualities = isHls ? await probeQualities(resultUrl, referer) : null;

  const subtitles = subtitleUrls
    .map((subUrl) => {
      const lang = subtitleLangFromUrl(subUrl);
      return lang ? { lang, label: subtitleLabel(lang), url: subUrl } : null;
    })
    .filter(Boolean);

  return {
    url: resultUrl,
    headers: { Referer: referer },
    isHls,
    ...(qualities ? { qualities } : {}),
    ...(subtitles.length > 0 ? { subtitles } : {}),
  };
}

// Сколько раз пробовать быстрый HTTP-путь, прежде чем откатываться на
// Puppeteer ("старый способ") — большинство реальных сбоев HTTP-пути,
// найденных вживую по логам (см. коммит), похожи на транзиентные: "operation
// timed out" на запросе к embed_auto, случайный 404 у апстрима — повторный
// запрос через мгновение обычно проходит нормально, а откат на Puppeteer
// заметно дороже (секунды вместо десятков секунд). Одна неудача — ещё не
// повод сразу платить эту цену.
const HTTP_PATH_ATTEMPTS = 3;
const HTTP_PATH_RETRY_DELAY_MS = 500;

async function extractVideoseed({ shikimoriId, season, episode, embedUrl, translationLabel, background }) {
  // embedUrl/translationLabel — конкретная озвучка (embed/embed_serial с
  // default_audio_id + человекочитаемое имя из каталога), выбранная на
  // основном сайте, см. getVideoseedOwnPlayerTranslations() и resolve.ts.
  // Без них — старое поведение: сайт сам решает озвучку по умолчанию.
  //
  // В ОБОИХ случаях сначала пробуем быстрый HTTP-путь без браузера (см.
  // videoseed-http.js) — он сам берёт первую озвучку, если translationLabel
  // не задан, либо ищет совпадение по имени, если задан. Возвращает null при
  // любой аномалии (формат страницы изменился, эту озвучку не нашли по имени,
  // таймаут и т.п.) — несколько попыток подряд (см. HTTP_PATH_ATTEMPTS), и
  // только если ВСЕ провалились — откатываемся на Puppeteer с тем же
  // embedUrl, что и раньше (без изменений в его поведении).
  for (let attempt = 1; attempt <= HTTP_PATH_ATTEMPTS; attempt++) {
    const viaHttp = await extractViaHttp({ kinopoiskId: shikimoriId, season, episode, translationLabel });
    if (viaHttp && viaHttp !== 'translation_not_found') return viaHttp;
    if (viaHttp === 'translation_not_found') {
      // Не транзиентный сбой — статическая страница embed_auto просто не
      // перечисляет эту озвучку в своей разметке (см. комментарий в
      // videoseed-http.js). Повтор с тем же translationLabel гарантированно
      // получит тот же список — сразу откатываемся на Puppeteer вместо
      // того, чтобы жечь оставшиеся попытки и паузы между ними впустую.
      console.error(`[videoseed] Озвучка "${translationLabel}" не найдена на HTTP-пути — сразу откат на Puppeteer (повтор не поможет)...`);
      break;
    }
    if (attempt < HTTP_PATH_ATTEMPTS) {
      console.error(`[videoseed] HTTP-путь не сработал (попытка ${attempt}/${HTTP_PATH_ATTEMPTS}) — повтор...`);
      await new Promise((r) => setTimeout(r, HTTP_PATH_RETRY_DELAY_MS));
    }
  }
  console.error(`[videoseed] HTTP-путь не сработал — откат на Puppeteer...`);

  return serializeBrowserUse(() => extractViaPuppeteer({ shikimoriId, season, episode, embedUrl }), {
    priority: background ? 'low' : 'high',
  });
}

module.exports = { extractVideoseed };

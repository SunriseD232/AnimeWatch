'use strict';

const { toAbsoluteUrl, getSharedBrowser } = require('./browser');

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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Стандартные битрейт-тиры Videoseed CDN. Найдено вживую: путь извлечённого
 * URL содержит номер качества (.../{H}.mp4:hls:manifest.m3u8) и его можно
 * просто подставлять другими значениями В ТОМ ЖЕ подписанном пути — хэш
 * авторизации НЕ привязан к конкретному качеству (проверено: разные H дают
 * реально разный битрейт по размеру сегмента, а несуществующий тир — честный
 * 404, не молчаливый клэмп на ближайший). Поэтому нужен только один клик
 * Puppeteer + серия дешёвых GET на текстовый манифест (не сам видеопоток),
 * без необходимости лезть в плеер за каждым качеством отдельно.
 */
const QUALITY_CANDIDATES = [2160, 1440, 1080, 720, 480, 360, 240];

/** Пробует остальные тиры для URL вида .../{H}.mp4:hls:manifest.m3u8. */
async function probeQualities(url, referer) {
  const match = url.match(/^(.*\/)(\d{3,4})(\.mp4:hls:manifest\.m3u8)(\?.*)?$/);
  if (!match) return null;
  const [, prefix, , suffix, qs = ''] = match;

  const probes = await Promise.all(
    QUALITY_CANDIDATES.map(async (height) => {
      const candidateUrl = `${prefix}${height}${suffix}${qs}`;
      try {
        const res = await fetch(candidateUrl, {
          headers: { Referer: referer, 'User-Agent': UA },
          signal: AbortSignal.timeout(8_000),
        });
        return res.ok ? { height, url: candidateUrl } : null;
      } catch {
        return null;
      }
    }),
  );

  const qualities = probes.filter(Boolean).sort((a, b) => b.height - a.height);
  return qualities.length > 0 ? qualities : null;
}

/**
 * Субтитры — НЕ в самом HLS-манифесте (проверено: там только сегменты, ни
 * одного #EXT-X-MEDIA:TYPE=SUBTITLES) и не в API — плеер сам подгружает
 * готовые .vtt отдельными запросами (найдено сетевым перехватом при
 * извлечении видео, тем же проходом, без лишней загрузки страницы), путь
 * вида /contents/videos_sources/{bucket}/{id}/{lang}.vtt. Код языка — из
 * имени файла (rus/eng/...), человекочитаемая подпись — из таблицы ниже.
 */
const SUBTITLE_LABELS = {
  rus: 'Русский',
  eng: 'English',
  ukr: 'Українська',
  ger: 'Deutsch',
  fre: 'Français',
  spa: 'Español',
  ita: 'Italiano',
  chi: '中文',
  jpn: '日本語',
  kor: '한국어',
  tur: 'Türkçe',
  pol: 'Polski',
};

function subtitleLabel(lang) {
  return SUBTITLE_LABELS[lang.toLowerCase()] || lang.toUpperCase();
}

function subtitleLangFromUrl(url) {
  const match = url.match(/\/([a-zA-Z]{2,3})\.vtt(?:[?#]|$)/);
  return match ? match[1].toLowerCase() : null;
}

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

async function extractVideoseed({ shikimoriId, season, episode, embedUrl }) {
  // embedUrl — конкретная озвучка (embed/embed_serial с default_audio_id),
  // выбранная на основном сайте, см. getVideoseedOwnPlayerTranslations().
  // Без него — старое поведение: embed_auto по kinopoisk_id (сайт сам решает
  // озвучку по умолчанию).
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

module.exports = { extractVideoseed };

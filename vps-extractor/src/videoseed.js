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
    const videoUrl = mp4 || m3u8 || stream || videoUrls[0] || null;
    return { videoUrl, subtitleUrls };
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

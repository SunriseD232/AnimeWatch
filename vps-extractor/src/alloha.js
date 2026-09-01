'use strict';

const { toAbsoluteUrl, getSharedBrowser } = require('./browser');
const { subtitleLabel } = require('./subtitle-labels');

/**
 * Извлечение прямой видео-ссылки (и субтитров) из Alloha — см. README.md и
 * §12.5/§12.6 ARCHITECTURE.md основного репозитория за историю расследования
 * геоблока/антихотлинка, и коммит, добавивший этот файл в его нынешнем виде,
 * за историю реверс-инжиниринга ниже.
 *
 * 1. YummyAnime API → все iframe_url Alloha-эмбедов серии (разные озвучки).
 * 2. Синтетическая обёртка с <iframe src=embedUrl> — обходит анти-хотлинк
 *    (window !== window.top).
 * 3. Их плеер сам, при загрузке (БЕЗ клика — проверено вживую сетевым
 *    перехватом, см. коммит), делает POST на /bnsi/movies/{internalId} —
 *    и это САМ ПО СЕБЕ уже исчерпывающий ответ: все аудиодорожки (озвучка +
 *    оригинал) × все качества (прямые подписанные ссылки на CDN) + субтитры
 *    (tracks[], тоже готовые подписанные .vtt) одним JSON. Раньше вместо
 *    этого приходилось: сниффать сетевые запросы видео, кликать по плееру
 *    дважды (жест автовоспроизведения), крутить их непубличное UI-меню
 *    качества (см. историю — forceHighestQuality, ~50 строк хрупкого
 *    DOM-клика) и отличать рекламный decoy-ролик от настоящего. Всё это
 *    было обходом отсутствия структурированных данных — они, оказывается,
 *    были всегда, просто в другом ответе, который никто не читал.
 * 4. Puppeteer тут остаётся ОБЯЗАТЕЛЬНЫМ (в отличие от Videoseed, см.
 *    videoseed-http.js) — сам POST на /bnsi/ требует заголовок `borth`,
 *    вычисляемый их клиентским JS при каждом запросе. Найдено вживую (см.
 *    коммит): строка "borth" не встречается НИ В ОДНОМ из трёх бандлов
 *    плеера (runtime/401/app.js) как литерал — то есть это не статичный
 *    ключ и не переиспользуемый cookie/токен со страницы, а что-то,
 *    вычисляемое динамически (обфусцированно, посимвольно, и/или сторонним
 *    антибот-SDK — на странице есть сторонние скрипты вроде
 *    pc.alloviewroll.com/vast2.ufouxbwn.com, любой из которых кандидат).
 *    Это, по всей видимости, и есть тот самый "четвёртый, неопознанный
 *    слой защиты" из прошлого расследования (experiment/alloha-tls-
 *    fingerprint-spoofing, §12.5 ARCHITECTURE.md) — там его тоже не
 *    удалось обойти ни TLS-имперсонацией (node-wreq/CycleTLS), ни чистым
 *    RU IP, именно потому что ни один из этих подходов не исполняет их
 *    JS. Без запуска реального JS (т.е. без headless-браузера) значение
 *    borth взять неоткуда — воспроизвести с нуля не пытаемся: это as-is
 *    обфускация конкретно под их антибот, а не общая техника вроде
 *    TLS-фингерпринта, и её взлом — совсем другой объём работы.
 * 5. RU-прокси (ALLOHA_PROXY_SERVER) сейчас не задан и не нужен — гео-блок
 *    по IP, похоже, для IP этого VPS уже не проблема (см. историю его
 *    отключения). Если это изменится — см. resolveProxy()/PAC в browser.js,
 *    маршрутизация уже готова, просто добавить сервер обратно в .env.
 */

const YUMMY_BASE = 'https://api.yani.tv';
const REFERER = 'https://yani.tv/';
const WRAPPER_URL = 'https://yani.tv/__mediawatch_wrapper__';
const MAX_CANDIDATES = 4;
const BNSI_URL_RE = /\/bnsi\/movies\//;

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

/**
 * Открывает embedUrl в общем браузере через обёртку (обходит анти-хотлинк,
 * см. комментарий вверху файла) и ждёт JSON-ответ /bnsi/movies/{id} — их
 * плеер запрашивает его сам при загрузке, клик не нужен (проверено вживую
 * сетевым перехватом: запрос уходит ещё во время начальной загрузки
 * страницы). На случай, если это не всегда так (другой тайтл/версия
 * плеера) — один клик как подстраховка, если к первому таймауту ответа
 * ещё нет, а не как обязательный шаг.
 */
async function fetchBnsiData(browser, rawEmbedUrl) {
  const embedUrl = toAbsoluteUrl(rawEmbedUrl);
  if (!embedUrl) {
    console.error(`[alloha] Yummy отдал невалидный iframe_url: ${rawEmbedUrl}`);
    return null;
  }

  const page = await browser.newPage();
  try {
    let bnsiData;
    let bnsiStatus;
    page.on('response', (res) => {
      if (bnsiData !== undefined || !BNSI_URL_RE.test(res.url())) return;
      bnsiStatus = res.status();
      res
        .json()
        .then((json) => {
          bnsiData = json;
        })
        .catch((err) => {
          console.error(`[alloha] /bnsi/ ответ не распарсился как JSON: ${err.message}`);
          bnsiData = null;
        });
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
      request.continue().catch(() => {});
    });

    await page.setExtraHTTPHeaders({ Referer: REFERER });
    await page.goto(WRAPPER_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    const POLL_INTERVAL_MS = 200;
    let clicked = false;
    const deadline = Date.now() + 8_000;
    while (bnsiData === undefined && Date.now() < deadline) {
      // Подстраховка на середине окна ожидания — если /bnsi/ по какой-то
      // причине всё же ждёт жеста пользователя, а не срабатывает сам.
      if (!clicked && Date.now() > deadline - 5_000) {
        clicked = true;
        await page.mouse.click(640, 360).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (bnsiData === undefined) {
      console.error(`[alloha] ${embedUrl}: /bnsi/ не ответил за отведённое время`);
      return null;
    }
    if (!bnsiData) return null; // ответ пришёл, но не распарсился — см. лог выше

    return { data: bnsiData, embedOrigin: new URL(embedUrl).origin, status: bnsiStatus };
  } catch (err) {
    console.error(`[alloha] Puppeteer упал на ${embedUrl}:`, err);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Значение quality[высота] не всегда одна ссылка — у части тайтлов (найдено
 * вживую после жалобы пользователя, см. коммит) это ДВЕ ссылки на разные
 * CDN-зеркала одной строкой через литеральное " or ": "url1 or url2". Без
 * разбора это уходило как есть — ни один плеер такую "ссылку" открыть не
 * может (не URI вообще), отсюда и «не работает». Берём первое зеркало —
 * оба в проверенном случае вели на тот же vkvideo.cloud, просто разные
 * edge-хосты ("ce-..." / "ec-..."), полностью взаимозаменяемые.
 */
function firstMirror(value) {
  const str = String(value);
  const idx = str.indexOf(' or ');
  return idx === -1 ? str : str.slice(0, idx);
}

/**
 * /bnsi/movies/{id} → ResolvedStream. hlsSource — по одной записи на
 * аудиодорожку (озвучка/оригинал), у каждой quality: {высота: URL} с
 * готовыми подписанными ссылками (проверено вживую: 200 напрямую, только
 * с Referer/Origin эмбед-страницы, без дополнительных query-параметров).
 * Первую запись берём как основную (в единственном проверенном вживую
 * случае это была именно запрошенная озвучка, "оригинал" шёл вторым) —
 * тот же принцип "одна ссылка по умолчанию", что и у остальных источников.
 */
function buildResolvedStream(bnsiData, embedOrigin) {
  const track = bnsiData?.hlsSource?.[0];
  const qualityMap = track?.quality;
  if (!qualityMap || typeof qualityMap !== 'object') return null;

  const qualities = Object.entries(qualityMap)
    .map(([height, url]) => ({ height: Number(height), url: firstMirror(url) }))
    .filter((q) => Number.isFinite(q.height) && q.url)
    .sort((a, b) => b.height - a.height);
  if (qualities.length === 0) return null;

  // label — берём готовый от Alloha (напр. "(Russian) Субтитры"), а НЕ через
  // общий subtitleLabel(lang): у одного языка тут бывает НЕСКОЛЬКО разных
  // дорожек одновременно (проверено вживую: отдельно "(Russian) Надписи" —
  // видимо, надписи/вывески в кадре — и "(Russian) Субтитры" — полный
  // диалог, обе lang="rus") — subtitleLabel(lang) дал бы им ОДИНАКОВУЮ
  // подпись "Русский", и пользователь не смог бы отличить один пункт
  // селектора от другого.
  const subtitles = (Array.isArray(bnsiData.tracks) ? bnsiData.tracks : [])
    .filter((t) => t?.kind === 'captions' && t.src && t.language)
    .map((t) => ({ lang: t.language, label: t.label || subtitleLabel(t.language), url: firstMirror(t.src) }));

  return {
    url: qualities[0].url,
    headers: { Referer: `${embedOrigin}/`, Origin: embedOrigin },
    isHls: true,
    ...(qualities.length > 1 ? { qualities } : {}),
    ...(subtitles.length > 0 ? { subtitles } : {}),
  };
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

  // Puppeteer-извлечения (Alloha/Videoseed-fallback) сериализуются через
  // общий браузер — см. serializeBrowserUse в browser.js (вызывается уже в
  // server.js для alloha, здесь просто одно извлечение без своей очереди).
  const browser = await getSharedBrowser();
  for (const embedUrl of embedUrls) {
    const bnsi = await fetchBnsiData(browser, embedUrl);
    if (!bnsi) continue;
    const result = buildResolvedStream(bnsi.data, bnsi.embedOrigin);
    if (result) return result;
    console.error(`[alloha] ${embedUrl}: /bnsi/ (${bnsi.status}) ответил, но без пригодного hlsSource`);
  }
  return null;
}

module.exports = { extractAlloha };

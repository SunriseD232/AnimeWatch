'use strict';

const { fetch } = require('node-wreq');
const {
  UA,
  videoseedHost,
  buildEmbedUrl,
  probeQualities,
  subtitleLabel,
  subtitleLangFromUrl,
} = require('./videoseed-shared');

/**
 * HTTP-путь извлечения Videoseed — БЕЗ Puppeteer/Chromium вообще.
 *
 * Реверс-инжиниринг (см. коммит, добавивший этот файл, и историю в
 * ARCHITECTURE.md §12.5-12.6 — там же объяснение, почему это вообще
 * заработало на VPS, хотя раньше не работало на serverless Vercel):
 *
 * embed_auto блокирует запрос уже на уровне TLS/HTTP2-хендшейка, если тот не
 * похож на настоящий браузер (Sec-Fetch-Dest здесь не главное — тот же класс
 * защиты, что у Alloha /bnsi/). node-wreq — обёртка над Rust HTTP-клиентом,
 * умеющая по-настоящему воспроизводить TLS/JA3 и HTTP-параметры конкретного
 * браузера (в отличие от обычного fetch/got/axios — они все идут через
 * OpenSSL самого Node и этого не могут в принципе). Профиль chrome_147 +
 * ПРИНУДИТЕЛЬНЫЙ HTTP/1.1 (HTTP/2 стабильно даёт PROTOCOL_ERROR на этом
 * хосте — тот же симптом, что раньше ловили у CycleTLS) + вручную
 * выставленный Sec-Fetch-Dest: iframe (реального iframe тут нет, некому
 * выставить этот заголовок самому) — и embed_auto отдаёт 200 с полным HTML
 * страницы плеера, найдено и проверено вживую.
 *
 * Ключевая находка: страница плеера уже содержит ВЕСЬ конфиг — все сезоны,
 * все серии, все озвучки, готовые подписанные ссылки на CDN — прямо в себе,
 * в вызове `new Playerjs("#...")`. Рендерить страницу, кликать по плееру,
 * ждать сетевых запросов (как делает videoseed.js через Puppeteer) не нужно
 * вообще — можно просто распарсить этот один HTML-ответ.
 */
const BROWSER_PROFILE = { profile: 'chrome_147', http2: false, headers: true };
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Внутри payload'а Playerjs периодически встречаются "приманки" для наивных
 * скрейперов: маркер '|||' + самодостаточный base64-блок (сам по себе валиден,
 * заканчивается '='-паддингом), и сразу без разделителя — продолжение
 * настоящего потока. Сам блок при декодировании — случайный мусорный текст,
 * к реальным данным отношения не имеет; его наличие сбивает выравнивание
 * base64 (группы по 4 символа = 3 байта), из-за чего всё, что идёт ПОСЛЕ
 * вставки, декодируется в шум, если её не вырезать целиком. Найдено и
 * проверено эмпирически на реальном ответе embed_auto (5 вставок на конфиг
 * из 2 сезонов сериала).
 *
 * Возвращает null, если после '|||' не нашлось похожего на конец вставки
 * '=' — вместо того чтобы гадать, безопаснее отказаться и откатиться на
 * Puppeteer-путь (см. extractViaHttp ниже).
 */
function stripInlineDecoys(raw) {
  let out = '';
  let i = 0;
  for (;;) {
    const m = raw.indexOf('|||', i);
    if (m === -1) {
      out += raw.slice(i);
      return out;
    }
    out += raw.slice(i, m);
    let j = raw.indexOf('=', m + 3);
    if (j === -1) return null;
    if (raw[j + 1] === '=') j += 1;
    i = j + 1;
  }
}

/**
 * Разбирает `new Playerjs("#N<payload>")` со страницы embed'а. Первый символ
 * payload'а — индикатор кодировки самого Playerjs (найдено вживую: '2'),
 * не часть данных — если его не отбросить, base64-группы сдвигаются на
 * символ и всё декодируется в мусор. Остальное — base64 за вычетом вставок
 * (см. stripInlineDecoys) → JSON с полным деревом сезонов/серий/озвучек.
 *
 * Пробуем и с пропуском индикатора, и без — на случай, если кодировка
 * когда-нибудь сменится на '0'/'1' (нешифрованный режим Playerjs).
 */
function decodePlayerConfig(html) {
  const marker = 'new Playerjs("#';
  const m = html.indexOf(marker);
  if (m === -1) return null;
  const hashStart = m + marker.length;
  const end = html.indexOf('");', hashStart);
  if (end === -1) return null;
  const payload = html.slice(hashStart, end);

  for (const skip of [1, 0]) {
    const cleaned = stripInlineDecoys(payload.slice(skip));
    if (cleaned == null) continue;
    try {
      const obj = JSON.parse(Buffer.from(cleaned, 'base64').toString('utf8'));
      // Сериал: obj.file — массив групп/сезонов (см. findEpisodeEntry).
      // Фильм: obj.file — СТРОКА "{Озвучка1} url1;{Озвучка2} url2;..." прямо
      // на верхнем уровне конфига, без вложенных сезонов/серий вообще —
      // найдено и проверено вживую 2026-09-02 на "Дьявол носит Prada 2"
      // (kp=6373982): ЭТА проверка (раньше — только Array.isArray) отбрасывала
      // валидный конфиг фильма как "не распарсился", и извлечение КАЖДОГО
      // фильма (не сериала) на сайте безусловно откатывалось на Puppeteer —
      // самый частый источник "HTTP-путь не сработал" в логах.
      if (obj && (Array.isArray(obj.file) || typeof obj.file === 'string')) return obj;
    } catch {
      // пробуем второй вариант skip, прежде чем сдаться
    }
  }
  return null;
}

/** Ищет запись конкретной серии среди всех сезонов конфига — либо, для
 *  фильма, саму плоскую структуру верхнего уровня (см. decodePlayerConfig
 *  выше про оба формата obj.file). */
function findEpisodeEntry(config, season, episode) {
  if (Array.isArray(config.file)) {
    const wantId = `s${season || 1}v${episode}`;
    for (const group of config.file) {
      if (Array.isArray(group.folder)) {
        const found = group.folder.find((e) => e.id === wantId);
        if (found) return found;
      }
    }
    return null;
  }
  if (typeof config.file === 'string') {
    return { file: config.file, subtitle: config.subtitle };
  }
  return null;
}

/** "{Озвучка1} url1;{Озвучка2} url2;..." → [{label, url}]. */
function parseTranslations(fileStr) {
  return fileStr
    .split(';')
    .map((part) => {
      const m = part.trim().match(/^\{([^}]*)\}\s*(\S+)$/);
      return m ? { label: m[1].trim(), url: m[2].trim() } : null;
    })
    .filter(Boolean);
}

/** "[Label]url,[Label2]url2,..." → список URL субтитров (best-effort). */
function parseSubtitleUrls(subtitleStr) {
  if (!subtitleStr) return [];
  const urls = [];
  const re = /\[([^\]]*)\]([^,[]+)/g;
  let m;
  while ((m = re.exec(subtitleStr))) {
    const url = m[2].replace(/,+$/, '').trim();
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Ищет среди распарсенных озвучек ту, чей "{Label}" совпадает с
 * translationLabel (человекочитаемое имя из каталога — short_name/name, см.
 * ExtractParams.translationLabel в основном приложении). Сравнение мягкое
 * (без учёта регистра/пробелов по краям) — метки вживую совпадали буквально
 * (напр. "LostFilm", "Английский"), но лишняя строгость тут не нужна и
 * только повышает риск ложного промаха на ровном месте.
 *
 * null, если translationLabel не задан (сайт сам решает — берём первую) или
 * если совпадения не нашлось (тогда вызывающий код откатится на Puppeteer,
 * а не молча покажет случайную озвучку вместо запрошенной).
 */
function findTranslationByLabel(translations, translationLabel) {
  if (!translationLabel) return translations[0] ?? null;
  const norm = (s) => s.trim().toLowerCase();
  const want = norm(translationLabel);
  return translations.find((t) => norm(t.label) === want) ?? null;
}

/**
 * Общая первая половина обоих путей ниже: запросить embed_auto и добраться
 * до записи конкретной серии в конфиге Playerjs. Возвращает null при любой
 * аномалии (нет токена, не 200, конфиг не распарсился, серии нет в
 * конфиге) — вызывающий код откатывается на Puppeteer (extractViaHttp) или
 * просто ничего не фильтрует (listAvailableTranslations), регрессии не
 * создаёт ни там, ни там.
 */
async function fetchEpisodeEntry(kinopoiskId, season, episode) {
  const embedUrl = buildEmbedUrl(kinopoiskId, season, episode);
  if (!embedUrl) return null;
  const referer = `https://${videoseedHost()}/`;

  let res;
  try {
    res = await fetch(embedUrl, {
      browser: BROWSER_PROFILE,
      headers: {
        Referer: referer,
        'User-Agent': UA,
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
      timeout: FETCH_TIMEOUT_MS,
    });
  } catch (err) {
    console.error('[videoseed-http] Запрос embed_auto упал:', err instanceof Error ? err.message : err);
    return null;
  }
  if (res.status !== 200) {
    console.error(`[videoseed-http] embed_auto вернул статус ${res.status}`);
    return null;
  }

  const html = await res.text();
  const config = decodePlayerConfig(html);
  if (!config) {
    console.error('[videoseed-http] Не удалось разобрать конфиг Playerjs — формат страницы изменился?');
    return null;
  }

  const entry = findEpisodeEntry(config, season, episode);
  if (!entry || typeof entry.file !== 'string') {
    console.error(`[videoseed-http] Серия s${season || 1}v${episode} не найдена в конфиге`);
    return null;
  }
  return { entry, referer };
}

/**
 * Список РЕАЛЬНО доступных озвучек для конкретной серии — те же имена, что
 * показывает нативный `<select id="audio-track-select">` на embed-странице
 * после рендера (проверено вживую 2026-09-02 на "Мандалорце", kp=1118138:
 * список из этого же конфига совпал 1-в-1 со списком реального select'а),
 * но получаем их тем же быстрым HTTP-путём, без Puppeteer/клика.
 *
 * Нужен, чтобы НЕ предлагать пользователю на сайте озвучки, которых на самом
 * деле нет: `translation_iframe` в ответе каталога Videoseed (item=search) —
 * это список студий, которые ХОТЬ КОГДА-ТО озвучивали тайтл ЦЕЛИКОМ, а не
 * список того, что реально закодировано именно для ЭТОЙ серии на ЭТОМ
 * ресурсе — на части тайтлов эти списки расходятся (см. investigation
 * "Мятеж" kp=1240162 — 6 из 10 заявленных озвучек отсутствовали во ВСЕХ 8
 * проверенных сериях подряд). Раньше клик по такой в интерфейсе стоил
 * пользователю HTTP-неудачу + откат на Puppeteer (~9с) ради честной ошибки
 * "не найдено" — теперь основной сайт просто не показывает саму кнопку, см.
 * getVideoseedOwnPlayerTranslations в videoseed-catalog.ts.
 *
 * null — не удалось получить список (см. fetchEpisodeEntry) — вызывающий
 * код НЕ должен фильтровать список этим null (fail-open: лучше лишняя
 * кнопка, чем спрятанные все).
 */
async function listAvailableTranslations({ kinopoiskId, season, episode }) {
  const fetched = await fetchEpisodeEntry(kinopoiskId, season, episode);
  if (!fetched) return null;
  const translations = parseTranslations(fetched.entry.file);
  if (translations.length === 0) return null;
  return translations.map((t) => t.label);
}

/**
 * Основной путь извлечения Videoseed — БЕЗ Puppeteer/Chromium. Работает и
 * для дефолтной озвучки (translationLabel не задан — берём первую из
 * списка, "сайт сам решает"), и для конкретно выбранной пользователем (см.
 * findTranslationByLabel выше) — конфиг embed_auto содержит ВСЕ озвучки
 * сразу, отдельный embed с default_audio_id для этого не нужен.
 *
 * Возвращает null при любой аномалии (не 200, конфиг не распарсился, серии
 * нет в конфиге, запрошенную озвучку не нашли по имени) — вызывающий код
 * откатывается на Puppeteer, так что регрессии не создаёт.
 */
async function extractViaHttp({ kinopoiskId, season, episode, translationLabel }) {
  const fetched = await fetchEpisodeEntry(kinopoiskId, season, episode);
  if (!fetched) return null;
  const { entry, referer } = fetched;

  const translations = parseTranslations(entry.file);
  if (translations.length === 0) return null;
  const match = findTranslationByLabel(translations, translationLabel);
  if (!match) {
    console.error(`[videoseed-http] Озвучка "${translationLabel}" не найдена среди [${translations.map((t) => t.label).join(', ')}]`);
    // Строка-сентинел, не null — эту конкретную неудачу НЕ имеет смысла
    // повторять (см. HTTP_PATH_ATTEMPTS в videoseed.js): список озвучек на
    // статической странице embed_auto не изменится между попытками с
    // интервалом в 500мс, а искомого имени там просто нет. Разбор жалобы
    // «HEAD 9.48с» — воспроизведено вживую (kp=1240162, s1e6, translationLabel
    // "Английский"): 3 попытки подряд получали ОДИН И ТОТ ЖЕ список
    // ["HDrezka Studio", "KosharaSerials", "Sound Film", "WestFilm"], 2 из
    // них — чистая трата ~1с на лишний запрос+задержку перед откатом на
    // Puppeteer — тот на этот конкретный тайтл её тоже не находил (список из
    // этого же embed_auto конфига 1-в-1 совпадает с тем, что реально видно в
    // audio-track-select после рендера, см. listAvailableTranslations выше и
    // getVideoseedOwnPlayerTranslations в videoseed-catalog.ts, который
    // теперь вообще не предлагает такую озвучку пользователю).
    return 'translation_not_found';
  }
  const chosen = match.url;

  const isHls = chosen.includes('.m3u8');
  const qualities = isHls ? await probeQualities(chosen, referer) : null;

  const subtitles = parseSubtitleUrls(entry.subtitle)
    .map((subUrl) => {
      const lang = subtitleLangFromUrl(subUrl);
      return lang ? { lang, label: subtitleLabel(lang), url: subUrl } : null;
    })
    .filter(Boolean);

  return {
    url: chosen,
    headers: { Referer: referer },
    isHls,
    ...(qualities ? { qualities } : {}),
    ...(subtitles.length > 0 ? { subtitles } : {}),
  };
}

module.exports = { extractViaHttp, listAvailableTranslations };

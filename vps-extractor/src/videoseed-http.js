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
      if (obj && Array.isArray(obj.file)) return obj;
    } catch {
      // пробуем второй вариант skip, прежде чем сдаться
    }
  }
  return null;
}

/** Ищет запись конкретной серии среди всех сезонов конфига. */
function findEpisodeEntry(config, season, episode) {
  const wantId = `s${season || 1}v${episode}`;
  for (const group of config.file) {
    if (Array.isArray(group.folder)) {
      const found = group.folder.find((e) => e.id === wantId);
      if (found) return found;
    }
  }
  // Фильм (не сериал) — плоская структура без вложенных сезонов/серий, файл
  // лежит прямо в первой (единственной) группе. Не проверено вживую на
  // реальном фильме (тестировали только на сериале) — при несовпадении
  // формата findEpisodeEntry просто вернёт null и вызывающий код откатится
  // на Puppeteer, так что риска нет, только неиспользуемый быстрый путь для
  // фильмов до отдельной проверки.
  if (config.file.length > 0 && typeof config.file[0].file === 'string') {
    return config.file[0];
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
 * Только для случая БЕЗ выбранной пользователем озвучки (embedUrl не задан в
 * extractVideoseed, см. videoseed.js) — тогда, как и в старом Puppeteer-пути,
 * "сайт сам решает" озвучку по умолчанию; мы для простоты берём первую в
 * списке. Если пользователь явно выбрал озвучку (embedUrl с
 * default_audio_id из каталога) — сопоставить её конкретному "{Label}" из
 * этого конфига тут не из чего (нет доступа к человекочитаемому имени
 * озвучки, которое resolve.ts брал из videoseed-catalog.ts) — для этого
 * случая остаётся Puppeteer-путь без изменений.
 *
 * Возвращает null при любой аномалии (не 200, конфиг не распарсился, серии
 * нет в конфиге) — вызывающий код откатывается на Puppeteer, так что
 * регрессии не создаёт.
 */
async function extractViaHttp({ kinopoiskId, season, episode }) {
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

  const translations = parseTranslations(entry.file);
  if (translations.length === 0) return null;
  const chosen = translations[0].url;

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

module.exports = { extractViaHttp };

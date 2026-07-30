'use strict';

/**
 * Kodik (kodikplayer.com) — как и Sibnet, обычный fetch() без Puppeteer.
 * Публично задокументированный эндпоинт `/gvi` у них переименован в `/ftor`
 * (обфусцирован через atob() прямо в их JS-бандле — найдено вручную, grep
 * по литералам ничего не давал, см. историю расследования в git log).
 *
 * Пайплайн (весь протокол реверс-инжинирен из их же плеерного бандла):
 * 1. GET embed-страницы (kodikplayer.com/season|serial/.../{hash}/{qual}) —
 *    в инлайн-скрипте лежат `urlParams` (подписанные d/pd/ref + их sign),
 *    `type` ("seria"/"video"/...) и `videoId`, а также `vInfo.hash` — ЕГО
 *    и нужно слать в /ftor, НЕ hash из пути embed-URL! Для первой серии
 *    сезона они случайно совпадают (так и нашли рабочий кейс изначально),
 *    но для остальных серий расходятся — /ftor молча отдаёт 500
 *    "Неправильный хэш", если передать hash из URL вместо vInfo.hash
 *    (проверено вживую: серия 12 "Вайолет Эвергарден" ловилась именно так).
 * 2. POST на /ftor с этими параметрами + vInfo.hash — отдаёт JSON с `links`
 *    по качествам, каждая ссылка обфусцирована.
 * 3. Расшифровка ссылки: ROT18 по буквам (см. rot18Decode), затем base64.
 *    Тоже найдено в их бандле (не публичная документация, там раньше был
 *    другой алгоритм — видимо, тоже сменили вместе с /gvi→/ftor).
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function toAbsoluteUrl(url) {
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}

/** ROT18 по буквам (found in app.player_single.js), затем base64-декод. */
function decodeKodikSrc(src) {
  const rot18 = src.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0) + 18;
    const threshold = ch <= 'Z' ? 90 : 122;
    return String.fromCharCode(threshold >= code ? code : code - 26);
  });
  return Buffer.from(rot18, 'base64').toString('utf8');
}

async function extractKodik({ embedUrl }) {
  if (!embedUrl) {
    console.error('[kodik] embedUrl не задан');
    return null;
  }

  let html;
  try {
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': UA, Referer: 'https://yani.tv/' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[kodik] embed-страница вернула ${res.status}`);
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.error('[kodik] fetch embed-страницы упал:', err);
    return null;
  }

  const urlParamsMatch = html.match(/var urlParams = '([^']+)'/);
  const typeMatch = html.match(/var type = "([^"]+)"/);
  const videoIdMatch = html.match(/var videoId = "([^"]+)"/);
  // vInfo.hash — ДИНАМИЧЕСКИЙ токен этой конкретной загрузки страницы, не
  // путать со статичным hash в пути embed-URL (см. комментарий модуля).
  const hashMatch = html.match(/vInfo\.hash = '([^']+)'/);
  if (!urlParamsMatch || !typeMatch || !videoIdMatch || !hashMatch) {
    console.error('[kodik] Не нашли urlParams/type/videoId/vInfo.hash в разметке embed-страницы');
    return null;
  }
  const hash = hashMatch[1];

  let params;
  try {
    params = JSON.parse(urlParamsMatch[1]);
  } catch {
    console.error('[kodik] urlParams не распарсился как JSON');
    return null;
  }

  const body = new URLSearchParams({
    d: params.d,
    d_sign: params.d_sign,
    pd: params.pd,
    pd_sign: params.pd_sign,
    ref: decodeURIComponent(params.ref || ''),
    ref_sign: params.ref_sign,
    type: typeMatch[1],
    id: videoIdMatch[1],
    hash,
  });

  let data;
  try {
    const res = await fetch('https://kodikplayer.com/ftor', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Referer: embedUrl,
        Origin: 'https://kodikplayer.com',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[kodik] /ftor вернул ${res.status}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.error('[kodik] POST /ftor упал:', err);
    return null;
  }

  if (!data || typeof data.links !== 'object') {
    console.error('[kodik] /ftor не вернул links:', JSON.stringify(data).slice(0, 300));
    return null;
  }

  const qualities = [];
  for (const [heightStr, arr] of Object.entries(data.links)) {
    const height = Number(heightStr);
    const encoded = arr?.[0]?.src;
    if (!Number.isFinite(height) || !encoded) continue;
    const url = toAbsoluteUrl(decodeKodikSrc(encoded));
    if (url) qualities.push({ height, url });
  }
  qualities.sort((a, b) => b.height - a.height);
  if (qualities.length === 0) {
    console.error('[kodik] Ни одна ссылка не расшифровалась');
    return null;
  }

  return {
    url: qualities[0].url,
    headers: { Referer: 'https://kodikplayer.com/' },
    isHls: true,
    qualities,
  };
}

module.exports = { extractKodik };

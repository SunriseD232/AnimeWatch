'use strict';

/**
 * Sibnet (video.sibnet.ru) — в отличие от Alloha/Videoseed НЕ требует
 * Puppeteer вообще: обычный fetch() с реалистичным User-Agent проходит без
 * какой-либо антибот-защиты (проверено вживую). Единственное требование —
 * оба заголовка сразу (User-Agent И Referer), без любого из них апстрим
 * отдаёт 400/403 даже на страницу embed'а, не говоря о самом файле.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractVideoId(embedUrl) {
  try {
    const url = new URL(embedUrl);
    return url.searchParams.get('videoid');
  } catch {
    return null;
  }
}

async function extractSibnet({ embedUrl }) {
  const videoId = embedUrl ? extractVideoId(embedUrl) : null;
  if (!videoId) {
    console.error('[sibnet] Не удалось извлечь videoid из embedUrl:', embedUrl);
    return null;
  }

  const shellUrl = `https://video.sibnet.ru/shell.php?videoid=${videoId}`;
  let html;
  try {
    const res = await fetch(shellUrl, {
      headers: { 'User-Agent': UA, Referer: 'https://yummyani.me/' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[sibnet] shell.php вернул ${res.status} для videoid=${videoId}`);
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.error('[sibnet] fetch shell.php упал:', err);
    return null;
  }

  const match = html.match(/player\.src\(\[\{src:\s*"([^"]+)"/);
  if (!match) {
    console.error(`[sibnet] player.src(...) не найден в разметке (videoid=${videoId})`);
    return null;
  }

  const url = new URL(match[1], 'https://video.sibnet.ru').toString();
  return {
    url,
    headers: { Referer: shellUrl, 'User-Agent': UA },
    isHls: false,
  };
}

module.exports = { extractSibnet };

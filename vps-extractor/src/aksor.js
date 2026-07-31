'use strict';

/**
 * Aksor (player.aksor.tv) — как и Sibnet/Kodik/CVH, обычный fetch() без
 * Puppeteer: embed-страница сама React SPA, но реальные данные приходят с
 * публичного JSON API без какой-либо авторизации (найдено сетевым
 * перехватом Puppeteer один раз при расследовании — сам эндпоинт
 * НЕ требует браузера для регулярного извлечения).
 *
 * GET /api/video/{id} → { qualities: { q360, q480, q720, q1080, q2k, q4k } },
 * значение — прямая ссылка на .mpd (DASH-манифест) этого качества или null,
 * если апстрим его не закодировал. В отличие от HLS у остальных источников,
 * каждое качество — ОТДЕЛЬНЫЙ .mpd со своими сегментами (init-stream*.m4s +
 * chunk-stream*-NNNNN.m4s) в СВОЕЙ директории — не единый манифест с ABR-
 * вариантами. Поэтому качества тут — как у Kodik (набор {height,url}), но
 * сам формат — DASH, а не HLS (см. ResolvedStream.isDash, proxy.ts).
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REFERER = 'https://player.aksor.tv/';

const HEIGHT_BY_KEY = {
  q4k: 2160,
  q2k: 1440,
  q1080: 1080,
  q720: 720,
  q480: 480,
  q360: 360,
};

function extractVideoId(embedUrl) {
  const match = embedUrl.match(/\/video\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function extractAksor({ embedUrl }) {
  if (!embedUrl) {
    console.error('[aksor] embedUrl не задан');
    return null;
  }
  const videoId = extractVideoId(embedUrl);
  if (!videoId) {
    console.error('[aksor] Не удалось извлечь id из embedUrl:', embedUrl);
    return null;
  }

  let data;
  try {
    const res = await fetch(`https://player.aksor.tv/api/video/${videoId}`, {
      headers: { 'User-Agent': UA, Referer: REFERER },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[aksor] API вернул ${res.status} для id=${videoId}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.error('[aksor] fetch API упал:', err);
    return null;
  }

  const qualityMap = data?.qualities || {};
  const qualities = Object.entries(qualityMap)
    .filter(([, url]) => typeof url === 'string' && url)
    .map(([key, url]) => ({ height: HEIGHT_BY_KEY[key] || 0, url }))
    .filter((q) => q.height > 0)
    .sort((a, b) => b.height - a.height);

  if (qualities.length === 0) {
    console.error('[aksor] Ни одного качества в ответе API:', JSON.stringify(data).slice(0, 300));
    return null;
  }

  return {
    url: qualities[0].url,
    headers: { Referer: REFERER },
    isDash: true,
    qualities,
  };
}

module.exports = { extractAksor };

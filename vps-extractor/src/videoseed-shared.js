'use strict';

/**
 * Общие для обоих путей извлечения Videoseed (Puppeteer — videoseed.js, HTTP
 * без браузера — videoseed-http.js) константы и хелперы: URL embed'а, разбор
 * качеств/субтитров. Вынесено в отдельный модуль, чтобы не дублировать между
 * двумя путями — HTTP-путь появился позже как более быстрая альтернатива (см.
 * videoseed-http.js), но при любой его неудаче остаётся откат на Puppeteer,
 * поэтому оба пути должны жить и использовать одну и ту же логику качеств.
 */

function videoseedHost() {
  return process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net';
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function buildEmbedUrl(kinopoiskId, season, episode) {
  const token = process.env.VIDEOSEED_TOKEN;
  if (!token) return null;
  const url = new URL(`https://${videoseedHost()}/embed_auto/${kinopoiskId}/`);
  url.searchParams.set('token', token);
  url.searchParams.set('video', `s${season || 1}v${episode}`);
  return url.toString();
}

/**
 * Стандартные битрейт-тиры Videoseed CDN. Найдено вживую: путь извлечённого
 * URL содержит номер качества (.../{H}.mp4:hls:manifest.m3u8) и его можно
 * просто подставлять другими значениями В ТОМ ЖЕ подписанном пути — хэш
 * авторизации НЕ привязан к конкретному качеству (проверено: разные H дают
 * реально разный битрейт по размеру сегмента, а несуществующий тир — честный
 * 404, не молчаливый клэмп на ближайший).
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

// Субтитры — общий для Videoseed И Alloha хелпер, см. subtitle-labels.js
// (переехал туда, когда тем же самым обзавёлся alloha.js).
const { SUBTITLE_LABELS, subtitleLabel, subtitleLangFromUrl } = require('./subtitle-labels');

module.exports = {
  videoseedHost,
  UA,
  buildEmbedUrl,
  QUALITY_CANDIDATES,
  probeQualities,
  SUBTITLE_LABELS,
  subtitleLabel,
  subtitleLangFromUrl,
};

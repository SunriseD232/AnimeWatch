'use strict';

/**
 * CVH (ru.yummyani.me/iframeCVH.html) — обычный fetch(), без Puppeteer. Сам
 * плеер зовёт публичный JSON API cdnvideohub.com (никакой авторизации не
 * требует), который отдаёт прямую ссылку на HLS у Odnoklassniki (okcdn.ru).
 *
 * 1. GET .../player/sv/playlist?pub=745&id={anime_id}&aggr=mali — список
 *    всех {vkId, voiceStudio, episode} этого тайтла (anime_id тут — то же
 *    число, что Yummy подставляет в query embedUrl'а, НЕ его внутренний id).
 * 2. Находим нужную серию+озвучку → vkId.
 * 3. GET .../player/sv/video/{vkId} → sources.hlsUrl — подписанная ссылка
 *    okcdn.ru с параметром srcIp, привязанным к IP, СДЕЛАВШЕМУ этот запрос
 *    (проверено вживую: другой IP → 400). Байты видео поэтому должны идти
 *    через /relay этого же VPS — см. resolve.ts/proxy.ts на основном сайте.
 */
const PLAPI_BASE = 'https://plapi.cdnvideohub.com/api/v1';

async function extractCVH({ embedUrl }) {
  if (!embedUrl) {
    console.error('[cvh] embedUrl не задан');
    return null;
  }

  let animeId;
  let episode;
  let dubbingCode;
  try {
    const url = new URL(embedUrl);
    animeId = url.searchParams.get('anime_id');
    episode = url.searchParams.get('episode');
    dubbingCode = url.searchParams.get('dubbing_code');
  } catch {
    console.error('[cvh] embedUrl не парсится:', embedUrl);
    return null;
  }
  if (!animeId || !episode) {
    console.error('[cvh] embedUrl без anime_id/episode:', embedUrl);
    return null;
  }

  let playlist;
  try {
    const res = await fetch(
      `${PLAPI_BASE}/player/sv/playlist?pub=745&id=${encodeURIComponent(animeId)}&aggr=mali`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      console.error(`[cvh] playlist вернул ${res.status}`);
      return null;
    }
    playlist = await res.json();
  } catch (err) {
    console.error('[cvh] fetch playlist упал:', err);
    return null;
  }

  const items = Array.isArray(playlist?.items) ? playlist.items : [];
  const item = items.find(
    (it) => String(it.episode) === String(episode) && (!dubbingCode || it.voiceStudio === dubbingCode),
  );
  if (!item?.vkId) {
    console.error(`[cvh] Не нашли серию ${episode} озвучки "${dubbingCode}" среди ${items.length} записей`);
    return null;
  }

  let videoData;
  try {
    const res = await fetch(`${PLAPI_BASE}/player/sv/video/${encodeURIComponent(item.vkId)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[cvh] video/${item.vkId} вернул ${res.status}`);
      return null;
    }
    videoData = await res.json();
  } catch (err) {
    console.error('[cvh] fetch video упал:', err);
    return null;
  }

  const hlsUrl = videoData?.sources?.hlsUrl;
  if (!hlsUrl) {
    console.error('[cvh] Ответ video без sources.hlsUrl:', JSON.stringify(videoData).slice(0, 300));
    return null;
  }

  return { url: hlsUrl, headers: {}, isHls: true };
}

module.exports = { extractCVH };

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

/**
 * Как сопоставляется озвучка.
 *
 * В embedUrl от Yummy лежит `dubbing_code`, и он НЕ одного вида: у одних
 * тайтлов это отображаемое имя студии («AniLiberty», «Студийная Банда»,
 * «Dream Cast»), у других — транслитерированный слаг («manipulyator»,
 * «subvost»). CVH же в playlist отдаёт только отображаемое имя
 * («Манипулятор», «SubVost»). Пока сравнение было строгим, слаги не
 * совпадали НИКОГДА — и такие озвучки молча «не находились», хотя серия у
 * CVH есть. Проверено вживую: shikimori 63138, серия 1, обе озвучки —
 * dubbing_code «manipulyator»/«subvost», а voiceStudio «Манипулятор»/
 * «SubVost».
 *
 * Поэтому сравниваем по возрастанию вольности и останавливаемся на первом,
 * что сработало. Строгое сравнение остаётся первым шагом: там, где сейчас
 * всё работает, поведение не меняется ни на йоту — новые шаги включаются
 * только там, где раньше был отказ.
 */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** «Манипулятор» → «manipulyator», «SubVost» → «subvost», «Dream Cast» →
 *  «dreamcast». Приводит к общему виду обе стороны сравнения. */
function studioKey(value) {
  return String(value || '')
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/** Запись нужной серии и озвучки среди всех записей тайтла у CVH. */
function findItem(items, episode, dubbingCode, translationLabel) {
  const ofEpisode = items.filter((it) => String(it.episode) === String(episode));
  if (ofEpisode.length === 0) return null;
  // Озвучку не просили — берём первую этой серии, как и раньше.
  if (!dubbingCode) return ofEpisode[0];

  const exact = ofEpisode.find((it) => it.voiceStudio === dubbingCode);
  if (exact) return exact;

  const wantKey = studioKey(dubbingCode);
  const byKey = ofEpisode.find((it) => studioKey(it.voiceStudio) === wantKey);
  if (byKey) return byKey;

  // Последняя попытка — по человеческой подписи, которую знает сайт
  // («Субтитры Манипулятор» содержит «Манипулятор»). Полезна там, где
  // транслитерация разошлась в спорной букве (х → h/kh, щ → sch/shch).
  const label = studioKey(translationLabel);
  if (label) {
    const byLabel = ofEpisode.find((it) => {
      const studio = studioKey(it.voiceStudio);
      return studio.length >= 3 && label.includes(studio);
    });
    if (byLabel) return byLabel;
  }

  return null;
}

async function extractCVH({ embedUrl, translationLabel }) {
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
  const item = findItem(items, episode, dubbingCode, translationLabel);
  if (!item?.vkId) {
    // В лог — что именно предлагал CVH: без этого разбор такой жалобы
    // упирается в «не нашли» без единой подсказки, чего именно не хватило.
    const offered = items
      .filter((it) => String(it.episode) === String(episode))
      .map((it) => it.voiceStudio)
      .join(', ');
    console.error(
      `[cvh] Не нашли серию ${episode} озвучки "${dubbingCode}" среди ${items.length} записей` +
        (offered ? ` (у этой серии есть: ${offered})` : ''),
    );
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

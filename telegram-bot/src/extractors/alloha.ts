/**
 * Извлечение видео из Alloha через YummyAnime API + Puppeteer.
 *
 * Алгоритм:
 * 1. Получаем iframe_url из YummyAnime API (getYummyEpisode)
 * 2. Открываем iframe_url в Puppeteer
 * 3. Перехватываем сетевой запрос к .mp4 или .m3u8
 * 4. Извлекаем прямую видео-ссылку
 */

import puppeteer from 'puppeteer';

const YUMMY_BASE = 'https://api.yani.tv';

interface YummyVideoItem {
  video_id: number;
  iframe_url: string;
  number: string;
  data?: { dubbing?: string; player?: string };
}

interface YummyVideosResponse {
  response?: YummyVideoItem[];
}

/**
 * Получает iframe_url от YummyAnime для shikimori_id + episode.
 * Возвращает первый embed URL от Alloha-плеера.
 */
async function getYummyIframeUrl(
  shikimoriId: number,
  episode: number,
): Promise<string | null> {
  // Сначала получаем anime_id.
  const listRes = await fetch(
    `${YUMMY_BASE}/anime?shikimori_ids=${shikimoriId}&limit=1`,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!listRes.ok) return null;
  const listData: { response?: { anime_id: number }[] } =
    await listRes.json().catch(() => ({}));
  const animeId = listData?.response?.[0]?.anime_id;
  if (!animeId) return null;

  // Получаем видео.
  const videosRes = await fetch(
    `${YUMMY_BASE}/anime/${animeId}/videos`,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!videosRes.ok) return null;
  const videosData: YummyVideosResponse =
    await videosRes.json().catch(() => ({}));

  const items = (videosData?.response ?? []).filter(
    (it) => String(it.number) === String(episode),
  );
  if (items.length === 0) return null;

  // Берём первый iframe_url, который ведёт на Alloha.
  // Yummy возвращает Kodik, Alloha, Sibnet, Aksor.
  // Alloha обычно имеет 'player' = 'Alloha' или содержит 'alloha' в URL.
  const allohaItem = items.find(
    (it) =>
      it.data?.player?.toLowerCase().includes('alloha') ||
      it.iframe_url.toLowerCase().includes('alloha'),
  );

  return allohaItem?.iframe_url ?? items[0]?.iframe_url ?? null;
}

/**
 * Открывает embed-плеер в Puppeteer и перехватывает видео-запрос.
 */
async function extractVideoFromEmbed(
  embedUrl: string,
): Promise<string | null> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();

    // Перехватываем все сетевые запросы.
    const videoUrls: string[] = [];

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();

      // Нас интересуют .mp4, .m3u8, и потоковые URL.
      if (
        url.includes('.mp4') ||
        url.includes('.m3u8') ||
        url.includes('.ts?') ||
        url.includes('playlist.m3u8') ||
        url.includes('master.m3u8')
      ) {
        videoUrls.push(url);
        console.log(`[puppeteer] Найден видео-запрос: ${url.slice(0, 120)}...`);
      }

      request.continue();
    });

    // Устанавливаем referer для Alloha.
    await page.setExtraHTTPHeaders({
      Referer: 'https://yani.tv/',
    });

    await page.goto(embedUrl, {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    });

    // Ждём немного, чтобы плеер успел инициировать загрузку.
    await new Promise((r) => setTimeout(r, 5_000));

    // Закрываем страницу.
    await page.close();

    // Возвращаем первую найденную видео-ссылку.
    // Предпочитаем .mp4 над .m3u8 (прямой файл легче качать).
    const mp4 = videoUrls.find((u) => u.includes('.mp4'));
    const m3u8 = videoUrls.find(
      (u) => u.includes('.m3u8') || u.includes('playlist'),
    );

    return mp4 || m3u8 || videoUrls[0] || null;
  } catch (err) {
    console.error('[puppeteer/alloha] Ошибка:', err);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Извлекает прямую видео-ссылку из Alloha (через YummyAnime + Puppeteer).
 */
export async function extractAlloha(
  shikimoriId: number,
  episode: number,
): Promise<string | null> {
  console.log(`[alloha] Поиск video для shikimori ${shikimoriId} ep ${episode}...`);

  const embedUrl = await getYummyIframeUrl(shikimoriId, episode);
  if (!embedUrl) {
    console.log('[alloha] embed URL не найден');
    return null;
  }

  console.log(`[alloha] Embed URL получен: ${embedUrl.slice(0, 100)}...`);

  // Если это Kodik — не обрабатываем (у Kodik своя система).
  if (embedUrl.includes('kodik')) {
    console.log('[alloha] Это Kodik, пропускаем');
    return null;
  }

  const videoUrl = await extractVideoFromEmbed(embedUrl);
  return videoUrl;
}

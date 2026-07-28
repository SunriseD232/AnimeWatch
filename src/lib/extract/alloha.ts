import type { Browser } from 'puppeteer-core';
import { toAbsoluteUrl, launchBrowser } from './browser';
import type { ExtractParams, ResolvedStream } from './types';

/**
 * Извлечение прямой видео-ссылки из Alloha (через embed YummyAnime) —
 * механизм 1:1 перенесён из старого telegram-bot/src/extractors/alloha.ts:
 * там он использовался, чтобы скачать файл и переслать в Telegram; здесь —
 * чтобы сразу проксировать байты в собственный плеер сайта, без Telegram.
 *
 * Алгоритм:
 * 1. YummyAnime API → ВСЕ iframe_url'ы Alloha для серии (разные озвучки —
 *    разные embed'ы, см. §12.3 ARCHITECTURE.md: одна озвучка может просто
 *    не отдавать поток для конкретной серии, тогда пробуем следующую).
 * 2. По очереди открываем каждый в headless Chromium, перехватываем
 *    сетевые запросы, ждём появления .mp4/.m3u8. Первый успешный — наш.
 * 3. Возвращаем URL + Referer, с которым Alloha его отдаёт (хотлинк-защита).
 */

const YUMMY_BASE = 'https://api.yani.tv';
const REFERER = 'https://yani.tv/';
/** Не перебираем весь список бесконечно — типично 2-4 разных Alloha-эмбеда на серию. */
const MAX_CANDIDATES = 4;

interface YummyVideoItem {
  video_id: number;
  iframe_url: string;
  number: string;
  data?: { dubbing?: string; player?: string };
}

/**
 * Все Alloha-эмбеды для серии, деduped по iframe_url — Yummy отдаёт одну и
 * ту же озвучку под разными student-студиями с одинаковым embed, и наоборот,
 * разные озвучки нередко ведут на РАЗНЫЕ Alloha-эмбеды (свой movie/token на
 * каждую) — именно поэтому один "мёртвый" вариант не должен хоронить весь
 * источник, если рядом есть рабочий.
 */
async function getAllohaEmbedUrls(shikimoriId: number, episode: number): Promise<string[]> {
  const listRes = await fetch(
    `${YUMMY_BASE}/anime?shikimori_ids=${shikimoriId}&limit=1`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
  );
  if (!listRes.ok) return [];
  const listData: { response?: { anime_id: number }[] } = await listRes
    .json()
    .catch(() => ({}));
  const animeId = listData?.response?.[0]?.anime_id;
  if (!animeId) return [];

  const videosRes = await fetch(`${YUMMY_BASE}/anime/${animeId}/videos`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!videosRes.ok) return [];
  const videosData: { response?: YummyVideoItem[] } = await videosRes
    .json()
    .catch(() => ({}));

  const items = (videosData?.response ?? []).filter(
    (it) => String(it.number) === String(episode),
  );

  // Yummy возвращает Kodik/Alloha/Sibnet/Aksor/CVH вперемешку — берём
  // только те, что явно помечены как Alloha (Kodik — отдельный источник,
  // его обрабатывает KodikPlayer напрямую).
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const it of items) {
    const isAlloha =
      it.data?.player?.toLowerCase().includes('alloha') ||
      it.iframe_url?.toLowerCase().includes('alloha');
    if (!isAlloha || !it.iframe_url || seen.has(it.iframe_url)) continue;
    seen.add(it.iframe_url);
    urls.push(it.iframe_url);
  }
  return urls.slice(0, MAX_CANDIDATES);
}

async function interceptVideoUrl(browser: Browser, rawEmbedUrl: string): Promise<string | null> {
  const embedUrl = toAbsoluteUrl(rawEmbedUrl);
  if (!embedUrl) {
    console.error(`[alloha] Yummy отдал невалидный iframe_url: ${rawEmbedUrl}`);
    return null;
  }

  const page = await browser.newPage();
  try {
    const videoUrls: string[] = [];

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('.mp4') ||
        url.includes('.m3u8') ||
        url.includes('.ts?') ||
        url.includes('playlist.m3u8') ||
        url.includes('master.m3u8')
      ) {
        videoUrls.push(url);
      }
      request.continue();
    });

    await page.setExtraHTTPHeaders({ Referer: REFERER });
    // ⚠️ setExtraHTTPHeaders не гарантированно применяется к самому
    // top-level запросу навигации (только к подресурсам) — Referer для
    // ГЛАВНОГО документа нужно передавать через опцию `referer` у goto(),
    // это идёт напрямую в CDP Page.navigate. Без неё Alloha отдаёт 404
    // "Ошибка!" ещё до всякого плеера — подтверждено вручную (см. диалог):
    // прямой заход без Referer → HTTP 404, страница "Ошибка!".
    const response = await page.goto(embedUrl, {
      waitUntil: 'networkidle2',
      timeout: 30_000,
      referer: REFERER,
    });

    if (response && !response.ok()) {
      console.error(`[alloha] ${embedUrl} → HTTP ${response.status()} (нет доступа даже к странице)`);
      return null;
    }

    // Многие embed-плееры не начинают грузить поток сам по себе —
    // автовоспроизведение со звуком блокируется браузером без жеста
    // пользователя, а headless Chromium в этом смысле не отличается от
    // обычного. Кликаем в центр страницы (обычно там play-оверлей), чтобы
    // сдвинуть плеер с места, прежде чем слушать сеть.
    await page.mouse.click(640, 360).catch(() => {});
    await new Promise((r) => setTimeout(r, 5_000));

    if (videoUrls.length === 0) {
      console.error(`[alloha] Открыли ${embedUrl}, но не поймали ни одного видео-запроса`);
    }

    const mp4 = videoUrls.find((u) => u.includes('.mp4'));
    const m3u8 = videoUrls.find((u) => u.includes('.m3u8') || u.includes('playlist'));
    return mp4 || m3u8 || videoUrls[0] || null;
  } catch (err) {
    // Навигация/таймаут/что угодно у чужого эмбеда — не должно валить весь
    // запрос: пробуем следующий кандидат (см. extractAlloha).
    console.error(`[alloha] Puppeteer упал на ${embedUrl}:`, err);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function extractAlloha({
  shikimoriId,
  episode,
}: ExtractParams): Promise<ResolvedStream | null> {
  const embedUrls = await getAllohaEmbedUrls(shikimoriId, episode);
  if (embedUrls.length === 0) {
    console.error(`[alloha] Yummy не вернул Alloha-эмбед для shikimori ${shikimoriId} ep ${episode}`);
    return null;
  }

  // Один браузер на все попытки — Chromium холодно стартует секунды,
  // повторный запуск на каждый кандидат был бы намного дороже, чем просто
  // открыть новую вкладку.
  const browser = await launchBrowser();
  try {
    for (const embedUrl of embedUrls) {
      const url = await interceptVideoUrl(browser, embedUrl);
      if (url) {
        return { url, headers: { Referer: REFERER }, isHls: url.includes('.m3u8') };
      }
    }
  } finally {
    await browser.close();
  }

  return null;
}

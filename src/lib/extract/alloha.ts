import type { Browser } from 'puppeteer-core';
import { authenticateProxy, toAbsoluteUrl, launchBrowser, type ProxyConfig } from './browser';
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
 * 2. Открываем СИНТЕТИЧЕСКУЮ обёртку с <iframe src=embedUrl> внутри —
 *    ключевой момент: страница Alloha содержит анти-хотлинк скрипт, который
 *    проверяет `window !== window.top` (т.е. что её открыли именно внутри
 *    iframe) и, если это не так, СТИРАЕТ <body> и подставляет заглушку
 *    «Контент не найден или недоступен в вашем регионе» — при обычном
 *    `page.goto(embedUrl)` формально это выглядит как гео-блок по IP
 *    сервера, но это НЕ гео-блок: подтверждено вручную (см. git history,
 *    ARCHITECTURE.md §12.5) — с локального (не-RU) IP, но внутри iframe,
 *    страница отдаёт настоящий плеер и реальный поток. Прокси для этого не
 *    нужен вообще.
 * 3. Перехватываем сетевые запросы, ждём появления .mp4/.m3u8. Первый
 *    успешный (не декой вроде cdn.plyr.io/blank.mp4 — служебная заглушка
 *    Plyr, не настоящее видео) — наш.
 * 4. Возвращаем URL + Referer, с которым Alloha его отдаёт (хотлинк-защита).
 */

const YUMMY_BASE = 'https://api.yani.tv';
const REFERER = 'https://yani.tv/';
/**
 * Фиктивный top-level URL на реальном домене Yummy — на самом деле никогда
 * не уходит в сеть: перехватывается ДО реального запроса и наполняется
 * нашим HTML с <iframe>. Домен важен для Referer, который iframe
 * естественно унаследует при собственной навигации (см. выше).
 */
const WRAPPER_URL = 'https://yani.tv/__mediawatch_wrapper__';
/** Не перебираем весь список бесконечно — типично 2-4 разных Alloha-эмбеда на серию. */
const MAX_CANDIDATES = 4;
/** Служебная заглушка библиотеки видеоплеера Plyr — не настоящий контент. */
const DECOY_HOSTS = ['cdn.plyr.io'];

/** RU-прокси для обхода гео-блока Alloha — см. .env.example. */
function getProxyConfig(): ProxyConfig | undefined {
  const server = process.env.ALLOHA_PROXY_SERVER;
  if (!server) return undefined;
  return {
    server,
    username: process.env.ALLOHA_PROXY_USERNAME,
    password: process.env.ALLOHA_PROXY_PASSWORD,
  };
}

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
    await authenticateProxy(page, getProxyConfig());

    const videoUrls: string[] = [];
    const allUrls: string[] = [];
    const pageErrors: string[] = [];
    // Статусы ответов — request-событие статуса не даёт, а именно статус
    // бэкенд-API (напр. /bnsi/movies/{id}, который резолвит реальный файл
    // по id) — главный подозреваемый, если запросы обрываются молча.
    const responseStatuses: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`);
    });
    page.on('response', (res) => {
      const isBnsi = res.url().includes('/bnsi/');
      if (!res.ok() || isBnsi) {
        (async () => {
          let body = '';
          if (isBnsi) {
            body = await res
              .text()
              .then((t) => ` body=${t.slice(0, 300)}`)
              .catch((e) => ` body-read-failed=${e}`);
          }
          responseStatuses.push(`${res.status()} ${res.url()}${body}`);
        })().catch(() => {});
      }
    });

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();

      // Наш фиктивный top-level документ — отдаём HTML с iframe вместо
      // реального похода в сеть (WRAPPER_URL никогда не резолвится по DNS).
      if (url === WRAPPER_URL) {
        request
          .respond({
            status: 200,
            contentType: 'text/html',
            body: `<!DOCTYPE html><html><body style="margin:0"><iframe src="${embedUrl}" style="width:1280px;height:720px;border:0" allow="autoplay"></iframe></body></html>`,
          })
          .catch(() => {});
        return;
      }

      allUrls.push(url);
      if (
        !DECOY_HOSTS.some((host) => url.includes(host)) &&
        (url.includes('.mp4') ||
          url.includes('.m3u8') ||
          url.includes('.ts?') ||
          url.includes('playlist.m3u8') ||
          url.includes('master.m3u8'))
      ) {
        videoUrls.push(url);
      }
      request.continue().catch(() => {});
    });

    await page.setExtraHTTPHeaders({ Referer: REFERER });
    const response = await page.goto(WRAPPER_URL, {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    });

    if (response && !response.ok()) {
      console.error(`[alloha] Обёртка вернула HTTP ${response.status()} — не должно происходить`);
      return null;
    }

    // Многие embed-плееры не начинают грузить поток сам по себе —
    // автовоспроизведение со звуком блокируется браузером без жеста
    // пользователя, а headless Chromium в этом смысле не отличается от
    // обычного. Кликаем в центр iframe (обычно там play-оверлей), чтобы
    // сдвинуть плеер с места, прежде чем слушать сеть.
    await page.mouse.click(640, 360).catch(() => {});
    await new Promise((r) => setTimeout(r, 5_000));

    if (videoUrls.length === 0) {
      // Диагностика: сколько всего запросов, создался ли iframe, что реально
      // в его DOM, есть ли JS-ошибки — раньше это ловилось локальным тестом,
      // но в serverless-окружении (@sparticuz/chromium-min) ведёт себя иначе.
      const frames = page.frames();
      const allohaFrame = frames.find((f) => f.url().includes('alloha'));
      let frameInfo = 'iframe не найден среди page.frames()';
      if (allohaFrame) {
        const bodyText = await allohaFrame
          .evaluate(() => document.body?.innerText?.slice(0, 200) ?? null)
          .catch((e) => `evaluate упал: ${e}`);
        frameInfo = `iframe url=${allohaFrame.url()} bodyText=${JSON.stringify(bodyText)}`;
      }
      console.error(
        `[alloha] Открыли ${embedUrl}, но не поймали ни одного видео-запроса. ` +
          `Всего запросов: ${allUrls.length} (последние 10: ${JSON.stringify(allUrls.slice(-10))}). ` +
          `Фреймов: ${frames.length}. ${frameInfo}. ` +
          `JS-ошибки: ${pageErrors.length ? JSON.stringify(pageErrors.slice(0, 5)) : 'нет'}. ` +
          `Статусы ответов (не-2xx или /bnsi/): ${responseStatuses.length ? JSON.stringify(responseStatuses) : 'нет'}.`,
      );
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
  const browser = await launchBrowser(getProxyConfig());
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

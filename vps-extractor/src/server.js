'use strict';

require('dotenv').config();
const express = require('express');
const { extractAlloha } = require('./alloha');
const { extractVideoseed } = require('./videoseed');
const { extractSibnet } = require('./sibnet');
const { extractKodik } = require('./kodik');
const { extractCVH } = require('./cvh');
const { extractAksor } = require('./aksor');

const PORT = Number(process.env.PORT) || 3300;
const AUTH_TOKEN = process.env.EXTRACTOR_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('EXTRACTOR_AUTH_TOKEN не задан в окружении — обязателен, иначе эндпоинт открыт всем.');
  process.exit(1);
}

const app = express();
app.use(express.json());

/**
 * VPS на 1 ГБ RAM (см. README.md) — параллельные запуски Chromium могут
 * упереться в OOM. Сериализуем извлечения через простую очередь: следующий
 * запрос ждёт, пока не освободится текущий Chromium-процесс. Для личного
 * сайта с редкими промахами кэша (раз в ~15 мин на серию) это не проблема,
 * лишняя секунда-две ожидания в очереди незаметна.
 */
let queue = Promise.resolve();
function serialized(fn) {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Хосты, на которые /relay разрешено ходить — эндпоинт защищён Bearer-
// токеном, но не стоит открывать его как SSRF-прокси на произвольный URL
// при компрометации токена. solodcdn.com (Kodik) — превентивно, ещё не
// проверяли вживую блокирует ли он Vercel так же, как Sibnet/CVH.
const RELAY_ALLOWED_HOSTS = [
  /(^|\.)sibnet\.ru$/i,
  /(^|\.)okcdn\.ru$/i,
  /(^|\.)solodcdn\.com$/i,
  /(^|\.)videoseedcdn\.com$/i,
  /(^|\.)takehost-cdn\.aksor\.tv$/i, // Aksor — превентивно, симметрично RELAY_HOSTS в proxy.ts основного приложения.
];

function isRelayHostAllowed(hostname) {
  return RELAY_ALLOWED_HOSTS.some((re) => re.test(hostname));
}

/**
 * Проксирует байты апстрима через IP этого VPS. Нужен для источников, чей
 * CDN блокирует IP-диапазоны serverless-платформ (проверено вживую: Sibnet
 * отдаёт 403 на запрос с Vercel, тот же URL с этого VPS и с обычного
 * домашнего IP — 200/206). Puppeteer тут не нужен, только реюз IP.
 */
app.get('/relay', requireAuth, async (req, res) => {
  const { u, h } = req.query;
  if (typeof u !== 'string') return res.status(400).json({ error: 'bad params' });

  let target;
  try {
    target = new URL(u);
    if (target.protocol !== 'https:' || !isRelayHostAllowed(target.hostname)) {
      throw new Error('host not allowed');
    }
  } catch {
    return res.status(400).json({ error: 'bad url' });
  }

  let headers = {};
  if (typeof h === 'string') {
    try {
      headers = JSON.parse(h);
    } catch {
      return res.status(400).json({ error: 'bad headers' });
    }
  }
  const upstreamHeaders = { ...headers };
  if (req.headers.range) upstreamHeaders.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(target, { headers: upstreamHeaders, redirect: 'follow' });
  } catch (err) {
    console.error('[relay] fetch упал:', err);
    return res.status(502).json({ error: 'upstream_unreachable' });
  }

  res.status(upstream.status);
  // БЕЗ content-length: okcdn.ru (CVH) отдаёт для этих ссылок ЗАВЕДОМО
  // неверный content-length (проверено вживую: заголовок says 508, реальное
  // тело — 4846+ байт с #EXT-X-ENDLIST в конце). Скопировав его как есть,
  // Node обрубает наш ответ ровно на этой неверной длине, как только мы
  // пишем больше — именно так терялся хвост плейлиста. Без заголовка Node
  // сам включает chunked encoding и шлёт ровно то, что мы реально записали.
  for (const key of ['content-type', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(key);
    if (v) res.setHeader(key, v);
  }
  if (!upstream.body) return res.end();

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
  } catch (err) {
    console.error('[relay] Обрыв при чтении апстрима:', err);
  } finally {
    res.end();
  }
});

app.post('/extract', requireAuth, async (req, res) => {
  const { source, shikimoriId, season, episode, embedUrl } = req.body || {};
  const id = Number(shikimoriId);
  const ep = Number(episode);
  const se = Number(season) || 1;

  const NO_BROWSER_SOURCES = ['sibnet', 'kodik', 'cvh', 'aksor'];
  if (
    !['alloha', 'videoseed', ...NO_BROWSER_SOURCES].includes(source) ||
    !Number.isFinite(id) ||
    !Number.isFinite(ep)
  ) {
    return res.status(400).json({ error: 'bad params' });
  }
  // embedUrl — конкретная озвучка, выбранная пользователем на основном сайте
  // (см. resolve.ts). Валидируем здесь тоже: эндпоинт защищён токеном, но
  // не стоит открывать его как SSRF на произвольный URL при компрометации.
  let safeEmbedUrl;
  if (embedUrl != null) {
    if (typeof embedUrl !== 'string') {
      return res.status(400).json({ error: 'bad params' });
    }
    try {
      const parsed = new URL(embedUrl);
      if (parsed.protocol !== 'https:') throw new Error('not https');
      safeEmbedUrl = parsed.toString();
    } catch {
      return res.status(400).json({ error: 'bad embedUrl' });
    }
  }

  console.error(`[server] Извлечение: source=${source} shikimoriId=${id} season=${se} episode=${ep}`);

  try {
    // Sibnet/Kodik/CVH — обычный fetch(), не Puppeteer: не занимают очередь
    // Chromium (см. serialized() выше) и не блокируются/не блокируют
    // Alloha-извлечения.
    let result;
    if (source === 'sibnet') {
      result = await extractSibnet({ embedUrl: safeEmbedUrl });
    } else if (source === 'kodik') {
      result = await extractKodik({ embedUrl: safeEmbedUrl });
    } else if (source === 'cvh') {
      result = await extractCVH({ embedUrl: safeEmbedUrl });
    } else if (source === 'aksor') {
      result = await extractAksor({ embedUrl: safeEmbedUrl });
    } else {
      result = await serialized(() =>
        source === 'alloha'
          ? extractAlloha({ shikimoriId: id, episode: ep, embedUrl: safeEmbedUrl })
          : extractVideoseed({ shikimoriId: id, season: se, episode: ep, embedUrl: safeEmbedUrl }),
      );
    }
    if (!result) {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.json(result);
  } catch (err) {
    console.error('[server] Извлечение упало:', err);
    return res.status(502).json({ error: 'extract_failed', message: String(err && err.message) });
  }
});

app.listen(PORT, () => {
  console.error(`[server] Слушаю на порту ${PORT}`);
});

// PM2 restart/stop шлёт SIGTERM — закрываем общий Chromium-браузер (теперь
// один на Alloha+Videoseed, см. browser.js) и его прокси-мост, иначе они
// рискуют остаться осиротевшими процессами после каждого рестарта.
async function shutdown() {
  const { closeSharedBrowser } = require('./browser');
  await closeSharedBrowser();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

'use strict';

require('dotenv').config();
const express = require('express');
const { extractAlloha } = require('./alloha');
const { extractVideoseed } = require('./videoseed');
const { extractSibnet } = require('./sibnet');

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
// при компрометации токена.
const RELAY_ALLOWED_HOSTS = [/(^|\.)sibnet\.ru$/i];

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
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(key);
    if (v) res.setHeader(key, v);
  }
  if (!upstream.body) return res.end();
  const { Readable } = require('stream');
  Readable.fromWeb(upstream.body).pipe(res);
});

app.post('/extract', requireAuth, async (req, res) => {
  const { source, shikimoriId, season, episode, embedUrl } = req.body || {};
  const id = Number(shikimoriId);
  const ep = Number(episode);
  const se = Number(season) || 1;

  if (!['alloha', 'videoseed', 'sibnet'].includes(source) || !Number.isFinite(id) || !Number.isFinite(ep)) {
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
    // Sibnet — обычный fetch(), не Puppeteer: не занимает очередь Chromium
    // (см. serialized() выше) и не блокируется/не блокирует Alloha-извлечения.
    const result =
      source === 'sibnet'
        ? await extractSibnet({ embedUrl: safeEmbedUrl })
        : await serialized(() =>
            source === 'alloha'
              ? extractAlloha({ shikimoriId: id, episode: ep, embedUrl: safeEmbedUrl })
              : extractVideoseed({ shikimoriId: id, season: se, episode: ep }),
          );
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

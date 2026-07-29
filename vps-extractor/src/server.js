'use strict';

require('dotenv').config();
const express = require('express');
const { extractAlloha } = require('./alloha');
const { extractVideoseed } = require('./videoseed');

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

app.post('/extract', requireAuth, async (req, res) => {
  const { source, shikimoriId, season, episode, embedUrl } = req.body || {};
  const id = Number(shikimoriId);
  const ep = Number(episode);
  const se = Number(season) || 1;

  if (!['alloha', 'videoseed'].includes(source) || !Number.isFinite(id) || !Number.isFinite(ep)) {
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
    const result = await serialized(() =>
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

'use strict';

/**
 * Запуск headless Chromium на VPS (не serverless!) — см. README.md.
 *
 * Использовали @sparticuz/chromium-min (урезанный serverless-билд) первым
 * заходом — проверяли, была ли причиной блокировки Alloha именно
 * serverless-песочница Vercel (сетевой namespace, см. основной репозиторий
 * ARCHITECTURE.md §12.6 про node-wreq), а не сам билд Chromium. Результат:
 * /bnsi/ отклонил запрос и здесь (тот же generic 404), значит дело было
 * не в Vercel — перешли на обычный `puppeteer` (полный пакет, стандартный
 * недостающий бинарник Chromium качает сам при `npm install`).
 *
 * ⚠️ Puppeteer-extra + stealth-плагин сюда НЕ переносим: в основном
 * расследовании (см. experiment/alloha-tls-fingerprint-spoofing и §12.5
 * ARCHITECTURE.md) подмена JS-фингерпринта (WebGL/navigator.webdriver и
 * т.д.) не решила блокировку — значит не стоит своей сложности здесь.
 */

/** Protocol-relative URL ("//host/path") → абсолютный. См. основной репозиторий, тот же баг с Yummy. */
function toAbsoluteUrl(url) {
  if (!url) return null;
  const candidate = url.startsWith('//') ? `https:${url}` : url;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Локальный анонимный HTTP-прокси (proxy-chain), форвардящий на настоящий
 * SOCKS5-апстрим с логином/паролем — Chromium не умеет авторизованный
 * прокси напрямую ни для одного протокола.
 */
async function resolveProxy({ server, username, password }) {
  const { anonymizeProxy, closeAnonymizedProxy } = require('proxy-chain');

  const upstream = new URL(server);
  if (username) upstream.username = encodeURIComponent(username);
  if (password) upstream.password = encodeURIComponent(password);

  const localUrl = await anonymizeProxy(upstream.toString());
  return {
    launchArg: localUrl,
    close: () => closeAnonymizedProxy(localUrl, true).then(() => undefined),
  };
}

async function launchBrowser(proxyServerArg) {
  const puppeteer = require('puppeteer');

  return puppeteer.launch({
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      ...(proxyServerArg ? [`--proxy-server=${proxyServerArg}`] : []),
    ],
    defaultViewport: { width: 1280, height: 720 },
    headless: true,
  });
}

/**
 * Один общий Chromium-процесс для источников БЕЗ per-request прокси
 * (сейчас — только Videoseed). Запуск браузера — реально измеримые ~0.4-0.9с
 * на этой VPS (см. коммит), плюс на скромных 2ГБ RAM держать по отдельному
 * Chromium-процессу на КАЖДЫЙ параллельный запрос расточительно. Держим один
 * процесс живым между запросами, открываем/закрываем только страницы
 * (вкладки) — это безопасно для параллельных запросов (Puppeteer поддерживает
 * много страниц в одном браузере). Alloha сюда не переносим — её браузер
 * привязан к per-request прокси-мосту (см. alloha.js), пул усложнил бы это
 * без измеренной необходимости.
 */
let sharedBrowserPromise = null;

async function getSharedBrowser() {
  if (sharedBrowserPromise) {
    const browser = await sharedBrowserPromise;
    if (browser.isConnected()) return browser;
    sharedBrowserPromise = null; // упал/закрылся — перезапустим ниже
  }
  sharedBrowserPromise = launchBrowser();
  return sharedBrowserPromise;
}

/**
 * Явное закрытие общего браузера — вызывается при штатном завершении
 * процесса (см. server.js, SIGTERM/SIGINT от PM2 restart/stop). Без этого
 * дочерний процесс Chromium рискует остаться висеть осиротевшим после
 * `pm2 restart`, съедая память на и без того тесной VPS — раньше это было
 * не нужно, каждый запрос сам закрывал свой браузер по завершении.
 */
async function closeSharedBrowser() {
  if (!sharedBrowserPromise) return;
  const promise = sharedBrowserPromise;
  sharedBrowserPromise = null;
  try {
    const browser = await promise;
    if (browser.isConnected()) await browser.close();
  } catch {
    /* процесс всё равно завершается */
  }
}

module.exports = { toAbsoluteUrl, resolveProxy, launchBrowser, getSharedBrowser, closeSharedBrowser };

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

module.exports = { toAbsoluteUrl, resolveProxy, launchBrowser };

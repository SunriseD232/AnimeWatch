'use strict';

/**
 * Запуск headless Chromium на VPS (не serverless!) — см. README.md.
 *
 * Используем @sparticuz/chromium-min НАРОЧНО (не полный обычный Chromium
 * через `puppeteer`) — это эксперимент: проверяем, была ли причиной
 * блокировки Alloha именно serverless-песочница Vercel (сетевой namespace,
 * см. основной репозиторий ARCHITECTURE.md §12.6 про node-wreq), а не сам
 * билд Chromium. Если этот вариант всё равно упрётся в блокировку —
 * следующий шаг: обычный `puppeteer` (полный, недостающий бинарник качает
 * сам), см. README.md "Если chromium-min не сработает".
 *
 * ⚠️ Puppeteer-extra + stealth-плагин сюда НЕ переносим: в основном
 * расследовании (см. experiment/alloha-tls-fingerprint-spoofing и §12.5
 * ARCHITECTURE.md) подмена JS-фингерпринта (WebGL/navigator.webdriver и
 * т.д.) не решила блокировку — значит не стоит своей сложности здесь.
 */
const CHROMIUM_VERSION = '149.0.0';
const CHROMIUM_PACK_URL = `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_VERSION}/chromium-v${CHROMIUM_VERSION}-pack.x64.tar`;

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
  // Пакет — ESM с CJS-интеропом: require() даёт обёртку с .default, не сам модуль.
  const chromium = require('@sparticuz/chromium-min').default;
  const puppeteer = require('puppeteer-core');

  return puppeteer.launch({
    args: [
      ...chromium.args.filter((arg) => !arg.startsWith('--headless')),
      '--disable-dev-shm-usage',
      ...(proxyServerArg ? [`--proxy-server=${proxyServerArg}`] : []),
    ],
    defaultViewport: { width: 1280, height: 720 },
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  });
}

module.exports = { toAbsoluteUrl, resolveProxy, launchBrowser };

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

/** Те же домены, что videoseed.js резолвит через videoseedHost() — держим
 *  здесь отдельно (не импортируем videoseed.js), чтобы не тянуть его
 *  побочные модули в browser.js и не плодить круговую зависимость. */
function videoseedDirectHosts() {
  return {
    hosts: [process.env.VIDEOSEED_HOST || 'tv-1-kinoserial.net'],
    cdnSuffixes: ['videoseedcdn.com'],
  };
}

function allohaProxyConfig() {
  const server = process.env.ALLOHA_PROXY_SERVER;
  if (!server) return undefined;
  return {
    server,
    username: process.env.ALLOHA_PROXY_USERNAME,
    password: process.env.ALLOHA_PROXY_PASSWORD,
  };
}

/**
 * PAC (Proxy Auto-Config) вместо простого --proxy-server=... — нужен, чтобы
 * ОДИН Chromium-процесс мог одновременно обслуживать и Videoseed (без
 * прокси), и Alloha (обязательно через RU-прокси, иначе /bnsi/ отдаёт 404,
 * см. alloha.js) — --proxy-server сам по себе действует на ВЕСЬ процесс
 * разом, разного прокси на разные вкладки им не выставить.
 *
 * Домены Videoseed стабильны (свой хост + videoseedcdn.com, проверено
 * вживую) — их явно отпускаем DIRECT. Домены Alloha, наоборот, ПЛАВАЮЩИЕ
 * (embed/CDN рандомизируются между запросами — видели miyagi-as.stravers.live,
 * p.kinouz.online, vkvideo.cloud, *.yani.tv в разных сессиях), поэтому
 * перечислять их ненадёжно — вместо этого всё, что НЕ Videoseed, по
 * умолчанию идёт через RU-прокси. Раньше у Alloha это давало ТОТ ЖЕ эффект
 * (весь её персональный браузер сидел за прокси целиком), так что для неё
 * поведение не меняется.
 *
 * "; DIRECT" вторым вариантом в PROXY-директиве — на случай если сам мост
 * (proxy-chain) вдруг умрёт: тогда Videoseed это не касается (уже DIRECT),
 * а трафик Alloha просто пойдёт напрямую и предсказуемо упрётся в /bnsi/,
 * как и было бы при полностью упавшем прокси раньше — не хуже.
 */
function buildPacDataUri({ directHosts, directCdnSuffixes, proxyHostPort }) {
  const conditions = [
    ...directHosts.map((h) => `dnsDomainIs(host, "${h}")`),
    ...directCdnSuffixes.map((s) => `shExpMatch(host, "*.${s}")`),
  ];
  const directCheck = conditions.length > 0 ? conditions.join(' || ') : 'false';
  const fallback = proxyHostPort ? `"PROXY ${proxyHostPort}; DIRECT"` : '"DIRECT"';
  const pacScript = [
    'function FindProxyForURL(url, host) {',
    `  if (${directCheck}) { return "DIRECT"; }`,
    `  return ${fallback};`,
    '}',
  ].join('\n');
  return `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pacScript).toString('base64')}`;
}

async function launchBrowserWithPac(pacDataUri) {
  const puppeteer = require('puppeteer');
  return puppeteer.launch({
    args: ['--disable-dev-shm-usage', '--no-sandbox', `--proxy-pac-url=${pacDataUri}`],
    defaultViewport: { width: 1280, height: 720 },
    headless: true,
  });
}

/**
 * Один общий Chromium-процесс на ОБА Puppeteer-источника (Videoseed И
 * Alloha) — раньше были два отдельных браузера (Videoseed персистентный без
 * прокси, Alloha — свой на каждый запрос через RU-прокси, см. историю в
 * git), что на 1.9GB RAM этой VPS периодически роняло сайт целиком при
 * одновременной нагрузке от обоих (см. §12.6-related commit "launch-fresh-
 * close-per-request для Alloha"). Маршрутизация между Videoseed (DIRECT) и
 * Alloha (через мост resolveProxy()) — через PAC, см. buildPacDataUri выше.
 * Мост поднимаем ОДИН раз лениво (он лёгкий сам по себе, не Chromium) и
 * держим на весь процесс — как раньше в alloha.js.
 */
let sharedBrowserPromise = null;
let sharedProxyBridge = null;

async function getSharedBrowser() {
  if (sharedBrowserPromise) {
    const browser = await sharedBrowserPromise;
    if (browser.isConnected()) return browser;
    sharedBrowserPromise = null; // упал/закрылся — перезапустим ниже
  }

  const proxyConfig = allohaProxyConfig();
  let proxyHostPort;
  if (proxyConfig) {
    if (!sharedProxyBridge) {
      try {
        sharedProxyBridge = await resolveProxy(proxyConfig);
        console.error(`[browser] RU-прокси мост поднят (общий на весь процесс): ${sharedProxyBridge.launchArg}`);
      } catch (err) {
        console.error('[browser] resolveProxy() упал — трафик Alloha пойдёт напрямую (скорее всего сломается на /bnsi/):', err);
      }
    }
    if (sharedProxyBridge) {
      proxyHostPort = sharedProxyBridge.launchArg.replace(/^https?:\/\//, '');
    }
  } else {
    console.error('[browser] ALLOHA_PROXY_SERVER не задан — весь трафик общего браузера идёт напрямую');
  }

  const { hosts, cdnSuffixes } = videoseedDirectHosts();
  const pacDataUri = buildPacDataUri({ directHosts: hosts, directCdnSuffixes: cdnSuffixes, proxyHostPort });
  sharedBrowserPromise = launchBrowserWithPac(pacDataUri);
  return sharedBrowserPromise;
}

/**
 * Явное закрытие общего браузера И прокси-моста — вызывается при штатном
 * завершении процесса (см. server.js, SIGTERM/SIGINT от PM2 restart/stop).
 * Без этого дочерний процесс Chromium (и локальный анонимайзинг-мост)
 * рискуют остаться висеть осиротевшими после `pm2 restart`, съедая память
 * на и без того тесной VPS.
 */
async function closeSharedBrowser() {
  if (sharedBrowserPromise) {
    const promise = sharedBrowserPromise;
    sharedBrowserPromise = null;
    try {
      const browser = await promise;
      if (browser.isConnected()) await browser.close();
    } catch {
      /* процесс всё равно завершается */
    }
  }
  if (sharedProxyBridge) {
    await sharedProxyBridge.close().catch(() => {});
    sharedProxyBridge = null;
  }
}

module.exports = { toAbsoluteUrl, resolveProxy, launchBrowser, getSharedBrowser, closeSharedBrowser };

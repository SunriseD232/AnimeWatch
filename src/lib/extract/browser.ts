import type { Browser } from 'puppeteer-core';

/**
 * Запуск headless Chromium внутри serverless-функции Vercel — тот же приём,
 * что раньше использовал telegram-bot (см. git history), но без VPS.
 *
 * Пакет — @sparticuz/chromium-min, а не полный @sparticuz/chromium: у
 * полного бинарник (~70 МБ) лежит внутри npm-пакета и грузится по пути,
 * который Next.js вычисляет динамически при трассировке файлов для
 * serverless-функции — трейсер его не видит, бинарник не попадает в бандл
 * функции, и executablePath() падает в проде на Vercel (хотя локально всё
 * работает, т.к. файл физически лежит в node_modules). -min версия вместо
 * этого качает готовый архив Chromium с GitHub Releases при первом холодном
 * старте и кладёт в /tmp — тёплые вызовы переиспользуют распакованное.
 *
 * ⚠️ URL релиза жёстко привязан к версии пакета (см. package.json,
 * зафиксирована БЕЗ ^ — sparticuz не следует semver, ломающие изменения
 * бывают и в патч-версиях). При обновлении версии пакета — обновить и URL:
 * https://github.com/Sparticuz/chromium/releases
 */
const CHROMIUM_VERSION = '149.0.0';
const CHROMIUM_PACK_URL = `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_VERSION}/chromium-v${CHROMIUM_VERSION}-pack.x64.tar`;

/**
 * Готовит URL перед page.goto(): Yummy отдаёт iframe_url как protocol-
 * relative ("//alloha.yani.tv/...", без схемы) — валидный в браузере (он
 * резолвится относительно схемы страницы), но не для Puppeteer: `new URL()`
 * без базового адреса и `page.goto()` такую строку не принимают и не
 * возвращают "not found", а роняют весь Page.navigate протокольной ошибкой
 * ("Cannot navigate to invalid URL"), что раньше валило весь запрос.
 * Достраиваем схему (https — эмбеды всегда по HTTPS) и только потом
 * проверяем валидность; иначе (действительно битый URL) — null, источник
 * недоступен.
 */
export function toAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const candidate = url.startsWith('//') ? `https:${url}` : url;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? candidate : null;
  } catch {
    return null;
  }
}

export interface ProxyConfig {
  /** "socks5://host:port" или "http://host:port" — БЕЗ логина/пароля в самом URL. */
  server: string;
  username?: string;
  password?: string;
}

export interface ResolvedProxy {
  /** Локальный анонимный прокси ("http://127.0.0.1:PORT") — Chromium его понимает без авторизации. */
  launchArg: string;
  /** Останавливает локальный прокси-мост. Обязательно вызвать после browser.close(). */
  close: () => Promise<void>;
}

/**
 * Поднимает локальный анонимный HTTP-прокси (пакет proxy-chain), который
 * внутри форвардит на настоящий апстрим-прокси с логином/паролем — включая
 * SOCKS5, чего сам Chromium не умеет (у него `--proxy-server` не парсит
 * `user:pass@host` вообще ни для одного протокола: HTTP-прокси с паролем
 * требует отдельного `page.authenticate()` на CDP-уровне, а авторизованный
 * SOCKS5 не поддержан НИКАК). Для одного из присланных пользователем прокси
 * подтверждено на практике: HTTP(S)-порт вообще не отвечал (curl зависал),
 * рабочим оказался только SOCKS5 — отсюда и нужда в этом мосте, а не в
 * прямом `--proxy-server=socks5://user:pass@host:port` (Chromium его тихо
 * проигнорировал бы или срубил на первой странице).
 */
export async function resolveProxy(proxy: ProxyConfig): Promise<ResolvedProxy> {
  const { anonymizeProxy, closeAnonymizedProxy } = await import('proxy-chain');

  const upstream = new URL(proxy.server);
  if (proxy.username) upstream.username = encodeURIComponent(proxy.username);
  if (proxy.password) upstream.password = encodeURIComponent(proxy.password);

  const localUrl = await anonymizeProxy(upstream.toString());
  return {
    launchArg: localUrl,
    close: () => closeAnonymizedProxy(localUrl, true).then(() => undefined),
  };
}

export async function launchBrowser(proxyServerArg?: string): Promise<Browser> {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import('@sparticuz/chromium-min'),
    import('puppeteer-core'),
  ]);

  return puppeteer.launch({
    // chromium.args уже содержит набор флагов под serverless. Раньше сюда
    // добавляли --single-process --no-zygote (наследие бота на 1 ГБ RAM
    // VPS) — на Vercel Pro с Fluid compute память функции по умолчанию 2 ГБ
    // (задаётся в Dashboard → Settings → Functions, НЕ в vercel.json — при
    // Fluid compute он это поле не принимает), с запасом даже без бампа. А
    // --single-process у headless Chromium известен как источник случайных
    // крашей/зависаний, поэтому убрано. ⚠️ --single-process/--in-process-gpu/
    // --use-angle=swiftshader из chromium.args НЕ трогаем: это дефолты самого
    // sparticuz, вероятно нужные, чтобы браузер вообще запустился в их
    // урезанной serverless-песочнице — без реального Linux-окружения для
    // тестов рискованно их убирать (см. §12.5 ARCHITECTURE.md).
    //
    // Единственное, что фильтруем — их же "--headless='shell'": кавычки
    // ВНУТРИ строки доходят до Chromium буквально (spawn с массивом
    // аргументов, без шелла, некому их убрать), плюс конфликтует с нашим
    // отдельным `headless: true` ниже. Заменяем на чистый флаг.
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

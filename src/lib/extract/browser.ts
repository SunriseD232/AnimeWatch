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
 * Проверка перед page.goto(): Yummy иногда отдаёт iframe_url без схемы или
 * иначе битый — Puppeteer в таком случае не возвращает "not found", а роняет
 * весь Page.navigate протокольной ошибкой ("Cannot navigate to invalid
 * URL"), что раньше валило весь запрос. Лучше отсеять на входе и обработать
 * как «источник недоступен».
 */
export function isNavigableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export async function launchBrowser(): Promise<Browser> {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import('@sparticuz/chromium-min'),
    import('puppeteer-core'),
  ]);

  return puppeteer.launch({
    // chromium.args уже содержит набор флагов под serverless. Раньше сюда
    // добавляли --single-process --no-zygote (наследие бота на 1 ГБ RAM
    // VPS) — на Vercel Pro памяти на функцию хватает с запасом (см.
    // vercel.json), а --single-process у headless Chromium известен как
    // источник случайных крашей/зависаний, поэтому убрано.
    args: [...chromium.args, '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 720 },
    executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
    headless: true,
  });
}

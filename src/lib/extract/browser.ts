import type { Browser } from 'puppeteer-core';

/**
 * Запуск headless Chromium внутри serverless-функции Vercel — тот же приём,
 * что раньше использовал telegram-bot (см. git history), но без VPS:
 * @sparticuz/chromium несёт сжатый бинарник Chromium внутри npm-пакета и
 * распаковывает его в /tmp при первом запуске; puppeteer-core — только
 * протокол управления, без собственного скачанного Chromium (это и делает
 * бандл функции подъёмным для serverless).
 */
export async function launchBrowser(): Promise<Browser> {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);

  return puppeteer.launch({
    args: [
      ...chromium.args,
      '--disable-dev-shm-usage',
      // Каждый вызов — новая функция/страница; процесс живёт секунды, лишние
      // подпроцессы Chromium только тратят память лимита функции.
      '--single-process',
      '--no-zygote',
    ],
    defaultViewport: { width: 1280, height: 720 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

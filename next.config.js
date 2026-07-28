/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Не держим клиентский Router Cache для динамических страниц: при возврате
  // на главную «Продолжить просмотр» всегда подтягивается свежим из БД.
  experimental: {
    staleTimes: { dynamic: 0 },
    // puppeteer-core/@sparticuz/chromium-min (headless Chromium для
    // извлечения прямых видео-ссылок, см. src/lib/extract), proxy-chain
    // (RU-прокси для Alloha) и puppeteer-extra/-plugin-stealth (маскировка
    // отпечатка serverless-браузера, см. §12.5 ARCHITECTURE.md) — серверные
    // пакеты, вебпак их бандлить не должен.
    serverComponentsExternalPackages: [
      'puppeteer-core',
      '@sparticuz/chromium-min',
      'proxy-chain',
      'puppeteer-extra',
      'puppeteer-extra-plugin-stealth',
    ],
    // Stealth-плагин грузит свои evasions/* и часть их зависимостей (напр.
    // puppeteer-extra-plugin-user-preferences — реальный пакет в
    // package.json стелса, физически стоит в node_modules) динамическим
    // require(name), собранным из строки в рантайме — трейсер файлов Vercel
    // (nft) такие пути статически не видит и не кладёт их в бандл функции
    // (тот же класс бага, что раньше был с полным @sparticuz/chromium:
    // MODULE_NOT_FOUND в проде при рабочем require() локально). Форсируем
    // включение вручную; если всплывёт ещё одна "missing dependency" в
    // логах — она сюда же добавляется.
    // Полная цепочка (проверено по исходникам): stealth's user-agent-override
    // evasion → требует плагин 'user-preferences' → требует 'user-data-dir'
    // (у него самого зависимостей больше нет — конец цепочки).
    outputFileTracingIncludes: {
      '/api/proxy/**': [
        './node_modules/puppeteer-extra-plugin-stealth/evasions/**/*',
        './node_modules/puppeteer-extra-plugin-user-preferences/**/*',
        './node_modules/puppeteer-extra-plugin-user-data-dir/**/*',
      ],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'shikimori.one',
      },
      {
        protocol: 'https',
        hostname: '**.shikimori.one',
      },
      {
        protocol: 'https',
        hostname: 'nyaa.shikimori.one',
      },
      {
        protocol: 'https',
        hostname: 'desu.shikimori.one',
      },
    ],
  },
};

module.exports = nextConfig;

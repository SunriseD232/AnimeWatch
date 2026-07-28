/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Не держим клиентский Router Cache для динамических страниц: при возврате
  // на главную «Продолжить просмотр» всегда подтягивается свежим из БД.
  experimental: {
    staleTimes: { dynamic: 0 },
    // puppeteer-core/@sparticuz/chromium-min (headless Chromium для
    // извлечения прямых видео-ссылок, см. src/lib/extract) и proxy-chain
    // (RU-прокси для Alloha, см. §12.5 ARCHITECTURE.md) — серверные
    // пакеты, вебпак их бандлить не должен.
    serverComponentsExternalPackages: ['puppeteer-core', '@sparticuz/chromium-min', 'proxy-chain'],
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

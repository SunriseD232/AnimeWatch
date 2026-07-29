/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Не держим клиентский Router Cache для динамических страниц: при возврате
  // на главную «Продолжить просмотр» всегда подтягивается свежим из БД.
  experimental: {
    staleTimes: { dynamic: 0 },
    // proxy-chain (мост к RU-прокси, см. src/lib/mirror/proxyBridge.ts) и
    // undici (ProxyAgent для серверного fetch к зеркалу источника, см.
    // src/lib/mirror/upstreamFetch.ts) — серверные пакеты, вебпак их
    // бандлить не должен (см. §12.6 ARCHITECTURE.md; пробовали node-wreq
    // для TLS-имперсонации браузера — работал локально, но на самом Vercel
    // подменял цель запроса нашим же приложением, откачено). Раньше здесь
    // же стоял puppeteer-core/@sparticuz/chromium-min/puppeteer-extra —
    // весь этот путь снят с main и сохранён на ветке
    // experiment/alloha-tls-fingerprint-spoofing.
    serverComponentsExternalPackages: ['proxy-chain', 'undici'],
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

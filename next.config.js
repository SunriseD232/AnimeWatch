/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Не держим клиентский Router Cache для динамических страниц: при возврате
  // на главную «Продолжить просмотр» всегда подтягивается свежим из БД.
  experimental: {
    staleTimes: { dynamic: 0 },
    // proxy-chain (мост к RU-прокси, см. src/lib/mirror/proxyBridge.ts) и
    // node-wreq (TLS/JA3-отпечаток настоящего браузера для серверного fetch
    // к зеркалу источника — обычный fetch/undici оба источника рвут на TLS-
    // уровне, см. §12.6 ARCHITECTURE.md; нативный Rust-биндинг, вебпак его
    // бандлить не должен) — серверные пакеты. Раньше здесь же стоял
    // puppeteer-core/@sparticuz/chromium-min/puppeteer-extra — весь этот
    // путь снят с main и сохранён на ветке
    // experiment/alloha-tls-fingerprint-spoofing.
    serverComponentsExternalPackages: ['proxy-chain', 'node-wreq'],
    // node-wreq грузит платформенный нативный биндинг через require(строка,
    // собранная в рантайме из process.platform/arch) — трейсер файлов
    // Vercel (nft) такие пути статически не видит, тот же класс бага, что
    // раньше был с puppeteer-extra-plugin-stealth (см. историю коммитов
    // Add puppeteer-extra... / Fix nested glob@7...). Форсируем пакет для
    // рантайма Vercel (Amazon Linux, glibc — не musl).
    outputFileTracingIncludes: {
      '/api/proxy/mirror/**': ['./node_modules/@node-wreq/linux-x64-gnu/**/*'],
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Не держим клиентский Router Cache для динамических страниц: при возврате
  // на главную «Продолжить просмотр» всегда подтягивается свежим из БД.
  experimental: {
    staleTimes: { dynamic: 0 },
    // cycletls (TLS/JA3-имперсонация Chrome для relay-хопа к источникам —
    // см. src/lib/mirror/upstreamFetch.ts, §12.6 ARCHITECTURE.md; до неё
    // пробовали undici — не проходит TLS-проверку источников, и node-wreq —
    // на Vercel подменяла цель запроса нашим же приложением) — серверный
    // пакет, вебпак его бандлить не должен. Раньше здесь же стоял
    // puppeteer-core/@sparticuz/chromium-min/puppeteer-extra — весь этот
    // путь снят с main и сохранён на ветке
    // experiment/alloha-tls-fingerprint-spoofing.
    serverComponentsExternalPackages: ['cycletls'],
    // cycletls грузит платформенный Go-бинарник через fs.existsSync() +
    // child_process.spawn() (НЕ require()) — трейсер файлов Vercel (nft)
    // такое не видит вообще (в отличие от puppeteer-extra-plugin-stealth
    // или node-wreq, у которых хотя бы был require(строка) — этот класс
    // багов трейсинга нам уже хорошо знаком). Пакет содержит бинарники под
    // 7 платформ разом (~130 МБ распакованные) — форсируем ТОЛЬКО
    // linux-x64 (Vercel), не все семь (иначе раздули бы бандл функции
    // многократно).
    outputFileTracingIncludes: {
      '/api/proxy/mirror/**': ['./node_modules/cycletls/dist/index'],
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

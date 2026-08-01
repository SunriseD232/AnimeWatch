/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Самостоятельный хостинг на VPS (не Vercel) — standalone-сборка держит в
  // рантайме только реально нужные файлы/зависимости (.next/standalone),
  // а не полный node_modules — заметно меньше памяти на процесс `node
  // server.js`, что важно на машине с 2ГБ RAM (см. ARCHITECTURE.md).
  output: 'standalone',
  // Не держим клиентский Router Cache для динамических страниц: при возврате
  // на главную «Продолжить просмотр» всегда подтягивается свежим из БД.
  experimental: {
    staleTimes: { dynamic: 0 },
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

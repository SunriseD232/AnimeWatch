const { withSentryConfig } = require('@sentry/nextjs');

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

// withSentryConfig без SENTRY_AUTH_TOKEN просто пропускает загрузку
// сорсмапов (пишет предупреждение в лог сборки, не ломает билд) — так что
// оборачивание безопасно держать всегда, даже пока Sentry не подключён.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
});

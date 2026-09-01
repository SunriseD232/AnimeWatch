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
    // node-wreq — нативный (Rust) модуль, см. lib/extract/proxy.ts. Без этой
    // записи Next по умолчанию webpack-бандлит серверные зависимости (кроме
    // явно известных ему пакетов вроде sharp — тот особый случай, у Next
    // есть для него встроенная спецобработка) — нативный .node-бинарник в
    // такой бандл не попадает, а трассировщик standalone-сборки (nft) тогда
    // не видит реальных файлов node-wreq в node_modules и не копирует их в
    // .next/standalone — проверено вживую: пакет полностью отсутствовал в
    // standalone-выводе, пока не добавили сюда. С этой записью Next не
    // бандлит его вообще, оставляет обычным require() в рантайме — тогда
    // трассировка находит и копирует его как есть.
    serverComponentsExternalPackages: ['node-wreq'],
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

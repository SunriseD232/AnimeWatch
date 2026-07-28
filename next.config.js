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
    // Stealth-плагин (и его подключаемые эвэйжны/зависимости-плагины —
    // user-preferences, user-data-dir) грузят часть своего кода динамическим
    // require(name), собранным из строки в рантайме — трейсер файлов Vercel
    // (nft) такие пути статически не видит и не кладёт их в бандл функции
    // (тот же класс бага, что раньше был с полным @sparticuz/chromium:
    // MODULE_NOT_FOUND в проде при рабочем require() локально). Ниже —
    // весь транзитивный граф зависимостей puppeteer-extra +
    // puppeteer-extra-plugin-stealth (посчитан обходом package.json'ов
    // node_modules/*, см. git history), форсированно включённый целиком —
    // без этого пришлось бы чинить каждый "Cannot find module" по одному
    // за деплой (fs-extra → graceful-fs/jsonfile/universalify, rimraf →
    // glob/minimatch и т.д.).
    outputFileTracingIncludes: {
      '/api/proxy/**': [
        './node_modules/puppeteer-extra-plugin-stealth/**/*',
        './node_modules/@isaacs/cliui/**/*',
        './node_modules/@types/debug/**/*',
        './node_modules/@types/ms/**/*',
        './node_modules/ansi-regex/**/*',
        './node_modules/ansi-styles/**/*',
        './node_modules/arr-union/**/*',
        './node_modules/balanced-match/**/*',
        './node_modules/brace-expansion/**/*',
        './node_modules/clone-deep/**/*',
        './node_modules/color-convert/**/*',
        './node_modules/color-name/**/*',
        './node_modules/concat-map/**/*',
        './node_modules/cross-spawn/**/*',
        './node_modules/debug/**/*',
        './node_modules/deepmerge/**/*',
        './node_modules/eastasianwidth/**/*',
        './node_modules/emoji-regex/**/*',
        './node_modules/for-in/**/*',
        './node_modules/for-own/**/*',
        './node_modules/foreground-child/**/*',
        './node_modules/fs-extra/**/*',
        // rimraf@3 сам зависит от glob@^7 (не от корневого glob@10 — версии
        // конфликтуют, npm положил rimraf свою вложенную копию glob в
        // node_modules/rimraf/node_modules/glob, её и резолвит Node в первую
        // очередь). Обход package.json по плоской схеме (без учёта вложенных
        // node_modules) пропустил СОБСТВЕННЫЕ зависимости именно этой
        // вложенной copy glob@7 — они отличаются от зависимостей glob@10.
        './node_modules/fs.realpath/**/*',
        './node_modules/inflight/**/*',
        './node_modules/inherits/**/*',
        './node_modules/path-is-absolute/**/*',
        './node_modules/glob/**/*',
        './node_modules/graceful-fs/**/*',
        './node_modules/is-buffer/**/*',
        './node_modules/is-extendable/**/*',
        './node_modules/is-fullwidth-code-point/**/*',
        './node_modules/is-plain-object/**/*',
        './node_modules/isexe/**/*',
        './node_modules/isobject/**/*',
        './node_modules/jackspeak/**/*',
        './node_modules/jsonfile/**/*',
        './node_modules/kind-of/**/*',
        './node_modules/lazy-cache/**/*',
        './node_modules/lru-cache/**/*',
        './node_modules/merge-deep/**/*',
        './node_modules/minimatch/**/*',
        './node_modules/minipass/**/*',
        './node_modules/mixin-object/**/*',
        './node_modules/ms/**/*',
        './node_modules/path-key/**/*',
        './node_modules/path-scurry/**/*',
        './node_modules/puppeteer-extra-plugin/**/*',
        './node_modules/puppeteer-extra-plugin-user-data-dir/**/*',
        './node_modules/puppeteer-extra-plugin-user-preferences/**/*',
        './node_modules/rimraf/**/*',
        './node_modules/shallow-clone/**/*',
        './node_modules/shebang-command/**/*',
        './node_modules/shebang-regex/**/*',
        './node_modules/signal-exit/**/*',
        './node_modules/string-width/**/*',
        './node_modules/string-width-cjs/**/*',
        './node_modules/strip-ansi/**/*',
        './node_modules/strip-ansi-cjs/**/*',
        './node_modules/universalify/**/*',
        './node_modules/which/**/*',
        './node_modules/wrap-ansi/**/*',
        './node_modules/wrap-ansi-cjs/**/*',
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

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Тонкая нативная обёртка вокруг живого сайта — НЕ бандл статической копии.
 * server.url указывает WKWebView сразу на прод: сайт server-rendered
 * (Next.js + Supabase), часто обновляется, поэтому бандлить его копию в
 * приложение бессмысленно — она устареет мгновенно. www/index.html
 * (webDir) существует только потому, что `cap sync` требует его наличия,
 * реально не используется.
 *
 * Единственная причина существования этой обёртки — плагин ExternalDisplay
 * (см. ios/App/App/ExternalDisplayPlugin.swift): рендер видео на внешний
 * экран (очки Xreal) с продолжением воспроизведения при заблокированном
 * iPhone — то, что недостижимо из чистого веба (WKWebView останавливает
 * рендер в фоне/при блокировке, нет JS-доступа к внешнему UIScreen).
 *
 * appId — предварительный (ru.mediawatch.app), должен совпадать с Bundle ID,
 * зарегистрированным на developer.apple.com при настройке подписи в Codemagic.
 */
const config: CapacitorConfig = {
  appId: 'ru.mediawatch.app',
  appName: 'MediaWatch',
  webDir: 'www',
  server: {
    url: 'https://media-watch.ru',
    // Отдаём HTTP(S)-контент как есть, без переписывания схемы под capacitor:// —
    // проще для cookie/relative-URL поведения при указании на реальный домен.
    cleartext: false,
  },
  ios: {
    // 'never' — WKWebView занимает экран полностью, от края до края;
    // отступы под чёлку/Dynamic Island/домашний индикатор сайт расставляет
    // сам через env(safe-area-inset-*) на <body>, см. src/app/layout.tsx
    // (viewportFit: 'cover' + safe-area padding). 'automatic' пробовали
    // раньше — WKWebView сам добавлял свой инсет ПОВЕРХ уже отрисованной
    // страницы без safe-area CSS, из-за чего контент оказывался чуть
    // больше видимой области экрана (не помещался на iPhone 17 Pro).
    contentInset: 'never',
  },
};

export default config;

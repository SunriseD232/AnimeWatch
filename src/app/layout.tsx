import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';
import Navbar from '@/components/Navbar';
import { ToastProvider } from '@/components/ToastProvider';
import PwaRegister from '@/components/PwaRegister';
import PresenceHeartbeat from '@/components/PresenceHeartbeat';
import NativeAuthBridge from '@/components/NativeAuthBridge';
import OfflineSyncTrigger from '@/components/OfflineSyncTrigger';
import { PipPlayerHost } from '@/components/pip/PipPlayerHost';
import ThemeScript from '@/components/ThemeScript';
import ThemeSync from '@/components/ThemeSync';

// Inter — ближайшее веб-приближение SF Pro (см. tailwind.config.ts).
// next/font сам самохостит файлы шрифта — никаких внешних запросов в рантайме.
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MediaWatch — аниме, фильмы и сериалы',
  description:
    'Смотрите аниме, фильмы и сериалы и продолжайте с того же места на любом устройстве.',
  // Второй заход на PWA (см. PwaRegister.tsx) — в прошлый раз рендер на
  // мобильных ломал sw.js (наивно перехватывал ВСЕ fetch, включая навигацию,
  // и это конфликтовало с RSC-стримингом Next.js), не сам манифест. В этот
  // раз service worker сознательно не регистрируем вообще — iOS standalone-
  // режиму («На экран «Домой»») он не нужен, только manifest/appleWebApp.
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MediaWatch',
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  // cover — контент реально уходит под чёлку/Dynamic Island/домашний индикатор
  // (актуально для iOS PWA-режима и нативной обёртки, см. capacitor.config.ts
  // ios.contentInset: 'never') — без этого safe-area-отступы ниже на <body>
  // были бы просто равны нулю, а WKWebView без auto-инсета обрезал/сдвигал
  // бы контент по-своему, из-за чего страница на iPhone выглядела «чуть
  // больше, чем надо».
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning ниже: ThemeScript намеренно ставит inline
    // style на <html> ДО гидратации (иначе кадр чужой палитры), а React
    // видит на клиенте атрибут, которого не было в серверной разметке, и
    // ругается «Extra attributes from the server: style». Подавляем точечно
    // на этом узле — расхождение здесь ожидаемое, а не симптом ошибки.
    <html lang="ru" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* До любой отрисовки — иначе кадр стандартной палитры и перекраска
            на глазах у пользователя (см. components/ThemeScript.tsx). */}
        <ThemeScript />
      </head>
      {/* Верхний отступ безопасной зоны здесь НЕ ставится: его берёт на себя
          сама шапка (components/Navbar.tsx). Пока он висел на body, липкая
          шапка при прокрутке прилипала к нулю вьюпорта, то есть уезжала
          ПОД часы и индикатор заряда на iPhone — её содержимое оказывалось
          за строкой статуса. Теперь шапка закрывает эту зону собственным
          фоном, как принято в iOS. */}
      <body className="min-h-screen font-sans pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <PwaRegister />
        <ThemeSync />
        <PresenceHeartbeat />
        <NativeAuthBridge />
        <OfflineSyncTrigger />
        <ToastProvider>
          <PipPlayerHost>
            {/* Заглушка повторяет геометрию шапки вместе с безопасной зоной —
                иначе контент прыгает вверх в момент, когда шапка доезжает. */}
            <Suspense
              fallback={
                <div className="h-[57px] border-b border-white/5 pt-[env(safe-area-inset-top)]" />
              }
            >
              <Navbar />
            </Suspense>
            <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          </PipPlayerHost>
        </ToastProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';
import Navbar from '@/components/Navbar';
import { ToastProvider } from '@/components/ToastProvider';

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
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`dark ${inter.variable}`}>
      <body className="min-h-screen font-sans">
        <ToastProvider>
          <Suspense fallback={<div className="h-[57px] border-b border-white/5" />}>
            <Navbar />
          </Suspense>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}

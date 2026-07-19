import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import Navbar from '@/components/Navbar';
import { ToastProvider } from '@/components/ToastProvider';

export const metadata: Metadata = {
  title: 'MediaWatch — аниме, фильмы и сериалы',
  description:
    'Смотрите аниме, фильмы и сериалы и продолжайте с того же места на любом устройстве.',
};

export const viewport: Viewport = {
  themeColor: '#0d0d12',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <body className="min-h-screen">
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

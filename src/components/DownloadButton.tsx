'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import DownloadPicker from '@/components/DownloadPicker';

interface SeasonInfo {
  season: number;
  episodes: number;
}

interface Props {
  isAuthed: boolean;
  contentType: 'anime' | 'cinema';
  contentId: number;
  title: string;
  posterUrl: string | null;
  isSerial: boolean;
  totalEpisodes: number;
  seasons?: SeasonInfo[];
}

/**
 * Кнопка «Скачать» на карточке тайтла — видна только в нативном iOS-
 * приложении (см. offlineDownload.ts) авторизованным пользователям (см.
 * план офлайн-загрузок — доступ к загрузкам ограничен вошедшими). isNative
 * определяем в эффекте, а не на первом рендере — Capacitor.isNativePlatform()
 * на сервере (SSR) всегда false, а на устройстве после гидратации станет
 * true; если проверять прямо в рендере, React словит несовпадение
 * серверной/клиентской разметки.
 */
export default function DownloadButton({
  isAuthed,
  contentType,
  contentId,
  title,
  posterUrl,
  isSerial,
  totalEpisodes,
  seasons = [],
}: Props) {
  const [isNative, setIsNative] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
  }, []);

  if (!isAuthed || !isNative) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press flex items-center gap-2 rounded-full border border-white/10 bg-bg-card px-4 py-2.5 text-sm font-medium text-gray-100 hover:bg-bg-soft"
      >
        <span>⬇</span>
        <span>Скачать</span>
      </button>
      <DownloadPicker
        open={open}
        onClose={() => setOpen(false)}
        contentType={contentType}
        contentId={contentId}
        title={title}
        posterUrl={posterUrl}
        isSerial={isSerial}
        totalEpisodes={totalEpisodes}
        seasons={seasons}
      />
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';

interface Props {
  shikimoriId: number;
  contentType: 'anime' | 'cinema';
  season: number;
  episode: number;
  animeTitle: string;
  posterUrl: string | null;
  tgId: string;
  /** Источник, из которого берётся видео (для бота) */
  source: 'anilibria' | 'alloha' | 'videoseed';
}

type Status = 'idle' | 'loading' | 'pending' | 'extracting' | 'downloading' | 'sending' | 'completed' | 'failed';

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Слишком много запросов, попробуйте через минуту',
  daily_limit: 'Дневной лимит скачиваний исчерпан (3 в сутки)',
  telegram_not_linked: 'Сначала привяжите Telegram в профиле',
};

export default function DownloadButton({
  shikimoriId,
  contentType,
  season,
  episode,
  animeTitle,
  posterUrl,
  tgId,
  source,
}: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  // Проверяем статус при монтировании.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams({
        shikimori_id: String(shikimoriId),
        season: String(season),
        episode: String(episode),
      });
      const res = await fetch(`/api/download?${params.toString()}`);
      if (cancelled) return;
      if (res.ok) {
        const data = await res.json();
        if (data.status && data.status !== 'completed') {
          setStatus(data.status);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [shikimoriId, season, episode]);

  const handleDownload = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tg_id: tgId,
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: animeTitle,
          poster_url: posterUrl,
          season,
          episode,
          source,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      } else {
        const err = await res.json();
        setError(ERROR_MESSAGES[err.error] ?? err.error ?? 'Ошибка');
        setStatus('idle');
      }
    } catch {
      setError('Сетевая ошибка');
      setStatus('idle');
    }
  }, [tgId, contentType, shikimoriId, animeTitle, posterUrl, season, episode, source]);

  const statusLabel: Record<Status, string> = {
    idle: 'Скачать в Telegram',
    loading: '…',
    pending: 'В очереди',
    extracting: 'Извлекаем видео…',
    downloading: 'Скачиваем…',
    sending: 'Отправляем…',
    completed: '✓ Отправлено',
    failed: 'Ошибка',
  };

  const isBusy = ['loading', 'pending', 'extracting', 'downloading', 'sending'].includes(status);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={isBusy || status === 'completed'}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
          status === 'completed'
            ? 'bg-green-900/30 text-green-400 ring-1 ring-green-800/40'
            : isBusy
            ? 'bg-bg-card text-gray-500 ring-1 ring-white/10'
            : 'bg-accent text-white hover:bg-accent-hover'
        }`}
      >
        {status === 'idle' ? '📥 Скачать в Telegram' : statusLabel[status]}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

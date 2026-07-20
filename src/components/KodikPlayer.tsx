'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { useToast } from '@/components/ToastProvider';
import {
  KODIK_EVENTS,
  parseEpisode,
  type KodikMessage,
} from '@/lib/video/kodik-events';
import type { Translation } from '@/lib/video/types';
import type { ContentType } from '@/lib/types';

interface Props {
  shikimoriId: number;
  contentType: ContentType;
  episode: number;
  animeTitle: string;
  posterUrl: string | null;
  isAuthed: boolean;
  initialEmbedUrl: string;
  translations: Translation[];
  initialTranslationId: number | null;
  fallback: boolean;
  onEnded: () => void;
  /** Сообщает текущую позицию наверх (для переноса при смене источника). */
  onTimeUpdate?: (seconds: number) => void;
  /** Смена серии ВНУТРИ плеера Kodik → синхронизируем номер серии наверху. */
  onEpisodeChange?: (episode: number) => void;
}

/**
 * Плеер Kodik (iframe). Трекинг позиции — через события postMessage плеера.
 * Ловит и смену серии внутри самого плеера, чтобы прогресс писался под
 * правильным номером (иначе новая серия «не засчитывается»).
 */
export default function KodikPlayer({
  shikimoriId,
  contentType,
  episode,
  animeTitle,
  posterUrl,
  isAuthed,
  initialEmbedUrl,
  translations,
  initialTranslationId,
  fallback,
  onEnded,
  onTimeUpdate,
  onEpisodeChange,
}: Props) {
  const { toast } = useToast();

  const [embedUrl, setEmbedUrl] = useState(initialEmbedUrl);
  const [translationId, setTranslationId] = useState<number | null>(
    initialTranslationId,
  );
  // Активная серия: стартует с пропа, но может измениться из самого плеера.
  const [activeEpisode, setActiveEpisode] = useState(episode);

  const currentTimeRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const translationRef = useRef<number | null>(initialTranslationId);
  translationRef.current = translationId;
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const onEpisodeChangeRef = useRef(onEpisodeChange);
  onEpisodeChangeRef.current = onEpisodeChange;

  const isCinema = contentType === 'cinema';

  const getState = useCallback(
    () => ({
      position: currentTimeRef.current,
      duration: durationRef.current,
      translationId: translationRef.current,
      episode: activeEpisodeRef.current,
    }),
    [],
  );

  const save = useProgressSaver({
    contentType,
    shikimoriId,
    animeTitle,
    posterUrl,
    isAuthed,
    getState,
    playingRef,
  });

  // Подписка на события Kodik через postMessage.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as KodikMessage | undefined;
      if (typeof data !== 'object' || !data?.key) return;

      // Смена серии внутри плеера: и по спец-событию, и по старту нового видео.
      if (
        data.key === KODIK_EVENTS.CURRENT_EPISODE ||
        data.key === KODIK_EVENTS.VIDEO_STARTED
      ) {
        const ep = parseEpisode(data.value);
        if (ep != null && ep >= 1 && ep !== activeEpisodeRef.current) {
          // Новая серия — сбрасываем позицию, чтобы не записать старую под ней.
          currentTimeRef.current = 0;
          durationRef.current = null;
          activeEpisodeRef.current = ep;
          setActiveEpisode(ep);
          onEpisodeChangeRef.current?.(ep);
        }
      }

      switch (data.key) {
        case KODIK_EVENTS.TIME_UPDATE:
          if (typeof data.value === 'number') {
            currentTimeRef.current = data.value;
            onTimeUpdateRef.current?.(data.value);
          }
          break;
        case KODIK_EVENTS.DURATION_UPDATE:
          if (typeof data.value === 'number') durationRef.current = data.value;
          break;
        case KODIK_EVENTS.VIDEO_STARTED:
        case KODIK_EVENTS.PLAY:
          playingRef.current = true;
          break;
        case KODIK_EVENTS.PAUSE:
          playingRef.current = false;
          save();
          break;
        case KODIK_EVENTS.VIDEO_ENDED:
          playingRef.current = false;
          save();
          onEnded();
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [save, onEnded]);

  async function changeTranslation(nextId: number) {
    if (nextId === translationId) return;
    try {
      const params = new URLSearchParams({
        [isCinema ? 'kinopoiskId' : 'shikimoriId']: String(shikimoriId),
        episode: String(activeEpisodeRef.current),
        translationId: String(nextId),
        startFrom: String(Math.floor(currentTimeRef.current)),
      });
      const res = await fetch(`/api/kodik?${params.toString()}`);
      if (!res.ok) throw new Error('Не удалось сменить озвучку');
      const data = (await res.json()) as { embedUrl: string };
      setTranslationId(nextId);
      setEmbedUrl(data.embedUrl);
      save();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        {fallback ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-soft p-6 text-center">
            <div className="text-4xl">🎬</div>
            <p className="text-sm font-medium text-gray-200">
              Видео недоступно в демо-режиме
            </p>
            <p className="max-w-md text-xs leading-relaxed text-gray-400">
              Нужен{' '}
              <code className="rounded bg-black/30 px-1">KODIK_TOKEN</code> —
              добавьте его в окружение, чтобы подключить плеер Kodik.
            </p>
          </div>
        ) : (
          <iframe
            key={embedUrl}
            src={embedUrl}
            title={`${animeTitle} — серия ${activeEpisode}`}
            allowFullScreen
            allow="autoplay *; fullscreen *"
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-300">
          Источник: Kodik
        </span>
        {translations.length > 0 && (
          <>
            <span className="ml-1 text-gray-400">Озвучка:</span>
            <select
              value={translationId ?? ''}
              onChange={(e) => changeTranslation(Number(e.target.value))}
              className="rounded-lg border border-white/10 bg-bg-card px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
            >
              {translations.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}

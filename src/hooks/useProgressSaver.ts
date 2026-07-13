'use client';

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

interface PlaybackState {
  position: number;
  duration: number | null;
  translationId: number | null;
}

interface Args {
  shikimoriId: number;
  episode: number;
  animeTitle: string;
  posterUrl: string | null;
  isAuthed: boolean;
  /** Возвращает текущее состояние воспроизведения (позиция/длительность). */
  getState: () => PlaybackState;
  /** Флаг «идёт воспроизведение» — для интервального сохранения. */
  playingRef: MutableRefObject<boolean>;
}

const SAVE_INTERVAL_MS = 10_000;
const MIN_POSITION = 5; // не сохраняем случайные открытия (< 5 сек)

/**
 * Общая логика сохранения прогресса для любого плеера (HLS / Kodik).
 * Пишет каждые 10 сек во время воспроизведения, при уходе со страницы и
 * скрытии вкладки (через sendBeacon, чтобы флаш не терялся). Возвращает
 * функцию ручного сохранения (например, для события pause).
 */
export function useProgressSaver({
  shikimoriId,
  episode,
  animeTitle,
  posterUrl,
  isAuthed,
  getState,
  playingRef,
}: Args) {
  // Держим getState в ref, чтобы save не пересоздавался каждый рендер.
  const getStateRef = useRef(getState);
  getStateRef.current = getState;

  const save = useCallback(
    (useBeacon = false) => {
      if (!isAuthed) return;
      const { position, duration, translationId } = getStateRef.current();
      if (!Number.isFinite(position) || position < MIN_POSITION) return;

      const payload = {
        shikimori_id: shikimoriId,
        anime_title: animeTitle,
        poster_url: posterUrl,
        episode,
        position_seconds: position,
        duration_seconds:
          duration != null && Number.isFinite(duration) ? duration : null,
        translation_id: translationId,
      };

      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(
          '/api/progress',
          new Blob([JSON.stringify(payload)], { type: 'application/json' }),
        );
      } else {
        fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {
          /* тихо игнорируем сетевые сбои */
        });
      }
    },
    [isAuthed, shikimoriId, episode, animeTitle, posterUrl],
  );

  // Интервальное сохранение во время воспроизведения.
  useEffect(() => {
    const id = setInterval(() => {
      if (playingRef.current) save();
    }, SAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [save, playingRef]);

  // Флаш при уходе со страницы / скрытии вкладки / размонтировании.
  useEffect(() => {
    const onBeforeUnload = () => save(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save(true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      save(true);
    };
  }, [save]);

  return save;
}

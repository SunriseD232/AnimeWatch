'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import type { HlsQuality, QualityLabel } from '@/lib/anilibria';

interface Props {
  shikimoriId: number;
  episode: number;
  animeTitle: string;
  posterUrl: string | null;
  isAuthed: boolean;
  qualities: HlsQuality[];
  /** Стартовая позиция для восстановления (сек) или null. */
  resumeFrom: number | null;
  onEnded: () => void;
  /** Сообщает текущую позицию наверх (для переноса при смене источника). */
  onTimeUpdate?: (seconds: number) => void;
}

/**
 * Нативный HLS-плеер на hls.js (источник AniLibria). Трекинг позиции идёт
 * напрямую по событию timeupdate — точнее, чем через чужие postMessage.
 */
export default function HlsPlayer({
  shikimoriId,
  episode,
  animeTitle,
  posterUrl,
  isAuthed,
  qualities,
  resumeFrom,
  onEnded,
  onTimeUpdate,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const playingRef = useRef(false);
  // Куда перемотать после загрузки манифеста (восстановление / смена качества).
  const seekTargetRef = useRef<number | null>(resumeFrom);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const [quality, setQuality] = useState<QualityLabel>(
    qualities[0]?.label ?? '720',
  );

  const currentSrc = qualities.find((q) => q.label === quality)?.url ?? null;

  const getState = useCallback(() => {
    const v = videoRef.current;
    return {
      position: v ? v.currentTime : 0,
      duration: v && Number.isFinite(v.duration) ? v.duration : null,
      translationId: null,
    };
  }, []);

  const save = useProgressSaver({
    shikimoriId,
    episode,
    animeTitle,
    posterUrl,
    isAuthed,
    getState,
    playingRef,
  });

  // Загрузка потока в <video> через hls.js.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentSrc) return;
    let cancelled = false;

    (async () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;

      // Сикаем на loadedmetadata — там video.duration уже известен
      // (на MANIFEST_PARSED длительность ещё NaN, и перемотка не срабатывает).
      const applySeek = () => {
        const target = seekTargetRef.current;
        if (target && target > 1 && video.duration && target < video.duration) {
          video.currentTime = target;
        }
        seekTargetRef.current = null;
      };
      video.addEventListener('loadedmetadata', applySeek, { once: true });

      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(currentSrc);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = currentSrc; // Safari/iOS
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentSrc]);

  // События воспроизведения → трекинг.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      playingRef.current = true;
    };
    const onPause = () => {
      playingRef.current = false;
      save();
    };
    const onEndedEvt = () => {
      playingRef.current = false;
      save();
      onEnded();
    };
    const onTime = () => onTimeUpdateRef.current?.(video.currentTime);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEndedEvt);
    video.addEventListener('timeupdate', onTime);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEndedEvt);
      video.removeEventListener('timeupdate', onTime);
    };
  }, [save, onEnded]);

  // Смена качества: запоминаем текущую позицию, чтобы восстановить после reload.
  function changeQuality(next: QualityLabel) {
    if (next === quality) return;
    const v = videoRef.current;
    if (v) seekTargetRef.current = v.currentTime;
    setQuality(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          poster={posterUrl ?? undefined}
          className="absolute inset-0 h-full w-full"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
          AniLibria · до {qualities[0]?.label ?? '720'}p
        </span>
        <span className="ml-1 text-gray-400">Качество:</span>
        {qualities.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => changeQuality(q.label)}
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              quality === q.label
                ? 'bg-accent text-white'
                : 'bg-bg-card text-gray-200 hover:bg-bg-soft',
            ].join(' ')}
          >
            {q.label}p
          </button>
        ))}
      </div>
    </div>
  );
}

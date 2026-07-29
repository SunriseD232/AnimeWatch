'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { formatTime } from '@/lib/format';
import type { ContentType } from '@/lib/types';
import type { ExtractSource } from '@/lib/extract/types';
import type { YummyTranslation } from '@/lib/video/yummy';

interface SkipSegment {
  time: number;
  length: number;
}

interface Props {
  contentType: ContentType;
  shikimoriId: number;
  season: number;
  episode: number;
  /** Источник, с которого сервер извлекает прямую ссылку (см. /api/proxy). */
  extractSource: ExtractSource;
  animeTitle: string;
  posterUrl: string | null;
  isAuthed: boolean;
  /** Стартовая позиция для восстановления (сек) или null. */
  resumeFrom: number | null;
  /** Доступные озвучки (эмбеды Alloha из списка переводов Yummy для этой
   *  серии) — селектор в левом верхнем углу плеера. */
  translations: YummyTranslation[];
  /** Озвучка, сохранённая с прошлого раза (по названию — id Yummy не
   *  стабилен между сериями, см. миграцию 0008). null — берём первую. */
  initialTranslationTitle: string | null;
  skipOpening?: SkipSegment | null;
  skipEnding?: SkipSegment | null;
  /** Ссылка на следующую серию — кнопка внутри плеера. null — некуда. */
  nextHref: string | null;
  nextLabel?: string;
  onEnded: () => void;
  /** Сообщает текущую позицию наверх (для переноса при смене источника). */
  onTimeUpdate?: (seconds: number) => void;
}

const VOLUME_KEY = 'aw:ownPlayerVolume';
const NEXT_BUTTON_WINDOW_S = 45;
const CONTROLS_HIDE_MS = 3_000;

const SOURCE_LABELS: Record<ExtractSource, string> = {
  alloha: 'Alloha',
  videoseed: 'Videoseed',
  sibnet: 'Sibnet',
};

type LoadState = 'probing' | 'ready' | 'unavailable' | 'failed';

/**
 * Собственный плеер MediaWatch. Источник байтов — /api/proxy: сервер сам
 * извлекает у эмбед-плеера (Alloha/Videoseed) прямую ссылку на видео и
 * проксирует её Range-кусками (см. §12 ARCHITECTURE.md) — без Telegram,
 * без полного скачивания на диск.
 *
 * Свои контролы (а не нативные <video controls>): кнопки пропуска опенинга/
 * титров и перехода на следующую серию видны и в фуллскрине — фуллскрин
 * берётся на весь контейнер, а не на сам <video>.
 */
export default function OwnPlayer({
  contentType,
  shikimoriId,
  season,
  episode,
  extractSource,
  animeTitle,
  posterUrl,
  isAuthed,
  resumeFrom,
  translations,
  initialTranslationTitle,
  skipOpening,
  skipEnding,
  nextHref,
  nextLabel,
  onEnded,
  onTimeUpdate,
}: Props) {
  // Выбор озвучки: сперва пробуем сохранённую (по названию), иначе первую
  // из списка. video_id Yummy меняется от серии к серии, поэтому именно
  // название — стабильный ключ сопоставления (см. миграцию 0008).
  const [translationId, setTranslationId] = useState<number | null>(() => {
    const saved = initialTranslationTitle
      ? translations.find((t) => t.title === initialTranslationTitle)
      : undefined;
    return saved?.id ?? translations[0]?.id ?? null;
  });
  const activeTranslation =
    translations.find((t) => t.id === translationId) ?? translations[0] ?? null;
  // Держим название текущей озвучки в ref — при смене серии translationId
  // (video_id) станет невалидным, а по названию найдём тот же перевод заново.
  const activeTranslationTitleRef = useRef<string | null>(activeTranslation?.title ?? null);
  activeTranslationTitleRef.current = activeTranslation?.title ?? activeTranslationTitleRef.current;
  // Каждая озвучка может идти через свой источник извлечения (Alloha/Sibnet/
  // ...) — используем его, а extractSource остаётся дефолтом только когда
  // список переводов пуст (раздел «Фильмы и сериалы», см. Player.tsx).
  const effectiveSource = activeTranslation?.source ?? extractSource;

  const src = `/api/proxy/${contentType}/${shikimoriId}/${season}/${episode}/${effectiveSource}${
    translationId != null ? `?t=${translationId}` : ''
  }`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  // Content-Type из проверочного HEAD (см. эффект резолва ниже) — переносится
  // во второй эффект (подключение к <video>), чтобы не запрашивать HEAD дважды.
  const upstreamContentTypeRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const seekTargetRef = useRef<number | null>(resumeFrom);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const skipOpeningRef = useRef(skipOpening);
  skipOpeningRef.current = skipOpening;
  const skipEndingRef = useRef(skipEnding);
  skipEndingRef.current = skipEnding;

  const [loadState, setLoadState] = useState<LoadState>('probing');
  // Инкремент форсирует повторный запуск эффекта резолва/подключения
  // источника ниже (у него зависимость — src, который при ретрае не меняется).
  const [reloadKey, setReloadKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activeSkip, setActiveSkip] = useState<'opening' | 'ending' | null>(null);
  const [isEnded, setIsEnded] = useState(false);

  // --- Прогресс просмотра ---------------------------------------------------
  const getState = useCallback(() => {
    const v = videoRef.current;
    return {
      position: v ? v.currentTime : 0,
      duration: v && Number.isFinite(v.duration) ? v.duration : null,
      translationId,
      translationTitle: activeTranslation?.title ?? null,
      episode,
      season,
    };
  }, [episode, season, translationId, activeTranslation]);

  const save = useProgressSaver({
    contentType,
    shikimoriId,
    animeTitle,
    posterUrl,
    isAuthed,
    getState,
    playingRef,
  });

  // --- Смена серии: список переводов приходит заново с сервера (новые
  // video_id) — пробуем найти ту же озвучку по названию, иначе первую. ---
  useEffect(() => {
    const wantTitle = activeTranslationTitleRef.current ?? initialTranslationTitle;
    const match = wantTitle ? translations.find((t) => t.title === wantTitle) : undefined;
    setTranslationId(match?.id ?? translations[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode]);

  // --- Громкость: восстановление/сохранение ---------------------------------
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) {
      setVolume(stored);
      if (videoRef.current) videoRef.current.volume = stored;
    }
  }, []);

  const applyVolume = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    setVolume(clamped);
    setMuted(clamped === 0);
    const v = videoRef.current;
    if (v) {
      v.volume = clamped;
      v.muted = clamped === 0;
    }
    window.localStorage.setItem(VOLUME_KEY, String(clamped));
  }, []);

  // --- Определение типа потока (HLS/mp4) и подключение источника -----------
  useEffect(() => {
    let cancelled = false;
    setLoadState('probing');
    setBuffering(true);
    setIsEnded(false);
    seekTargetRef.current = resumeFrom;

    (async () => {
      let contentType: string | null = null;
      let ok = false;
      try {
        const res = await fetch(src, { method: 'HEAD' });
        ok = res.ok;
        contentType = res.headers.get('content-type');
        if (!res.ok) {
          if (cancelled) return;
          setLoadState(res.status === 404 ? 'unavailable' : 'failed');
          return;
        }
      } catch {
        if (!cancelled) setLoadState('failed');
        return;
      }
      if (cancelled || !ok) return;

      // <video> монтируется только в ветке 'ready' ниже — значит ref
      // появится лишь СЛЕДУЮЩИМ рендером после setLoadState('ready').
      // Сразу подключать источник тут нельзя (videoRef.current ещё null).
      upstreamContentTypeRef.current = contentType;
      setLoadState('ready');
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, reloadKey]);

  // --- Подключение источника к <video>, когда он смонтирован (loadState === 'ready') ---
  useEffect(() => {
    if (loadState !== 'ready') return;
    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    (async () => {
      const isHls = (upstreamContentTypeRef.current ?? '').includes('mpegurl');
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (isHls) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hlsRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = src; // Safari/iOS — нативный HLS
        }
      } else {
        video.src = src;
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, reloadKey, loadState]);

  // --- События <video> -------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      const target = seekTargetRef.current;
      if (target && target > 1 && (!video.duration || target < video.duration)) {
        video.currentTime = target;
      }
      seekTargetRef.current = null;
    };
    const onPlay = () => {
      playingRef.current = true;
      setPlaying(true);
      setIsEnded(false);
    };
    const onPause = () => {
      playingRef.current = false;
      setPlaying(false);
      save();
    };
    const onEndedEvt = () => {
      playingRef.current = false;
      setPlaying(false);
      setIsEnded(true);
      save();
      onEnded();
    };
    const onTime = () => {
      const t = video.currentTime;
      setCurrentTime(t);
      onTimeUpdateRef.current?.(t);
      const op = skipOpeningRef.current;
      const end = skipEndingRef.current;
      if (op && t >= op.time && t < op.time + op.length) {
        setActiveSkip('opening');
      } else if (end && t >= end.time && t < end.time + end.length) {
        setActiveSkip('ending');
      } else {
        setActiveSkip(null);
      }
    };
    const onProgress = () => {
      try {
        const b = video.buffered;
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= video.currentTime && video.currentTime <= b.end(i)) {
            setBuffered(b.end(i));
            return;
          }
        }
      } catch {
        /* ignore */
      }
    };
    const onWaiting = () => setBuffering(true);
    const onCanPlay = () => setBuffering(false);
    const onError = () => setLoadState('failed');

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEndedEvt);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', onProgress);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onCanPlay);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEndedEvt);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onCanPlay);
      video.removeEventListener('error', onError);
    };
  }, [save, onEnded, loadState]);

  // --- Фуллскрин --------------------------------------------------------------
  useEffect(() => {
    const onFsChange = () =>
      setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    } else if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
  }, []);

  // --- Управление -------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.currentTime + delta, v.duration || Infinity));
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setCurrentTime(t);
  }, []);

  const skipCurrent = useCallback(() => {
    const segment =
      activeSkip === 'opening' ? skipOpeningRef.current : skipEndingRef.current;
    const v = videoRef.current;
    if (!v || !segment) return;
    v.currentTime = segment.time + segment.length;
    setActiveSkip(null);
  }, [activeSkip]);

  const retry = useCallback(() => {
    seekTargetRef.current = currentTime > 1 ? currentTime : resumeFrom;
    setReloadKey((k) => k + 1);
  }, [currentTime, resumeFrom]);

  // Ручная смена озвучки — переносим текущую позицию (src меняется вместе с
  // translationId, что уже само по себе перезапускает эффект резолва).
  const changeTranslation = useCallback(
    (id: number) => {
      seekTargetRef.current = currentTime > 1 ? currentTime : resumeFrom;
      setTranslationId(id);
    },
    [currentTime, resumeFrom],
  );

  // --- Автоскрытие контролов ----------------------------------------------------
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (playingRef.current) setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    showControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showControls, playing]);

  // --- Клавиатура ------------------------------------------------------------
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          applyVolume(volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          applyVolume(volume - 0.1);
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          applyVolume(muted || volume === 0 ? 0.5 : 0);
          break;
      }
      showControls();
    },
    [togglePlay, seekBy, applyVolume, toggleFullscreen, showControls, volume, muted],
  );

  // Селектор озвучки — виден в любом loadState (в т.ч. до/после ошибки), чтобы
  // можно было переключить озвучку, не дожидаясь текущей или после её отказа.
  const translationSelector = translations.length > 1 && (
    <div className="absolute left-3 top-3 z-20">
      <select
        value={translationId ?? ''}
        onChange={(e) => changeTranslation(Number(e.target.value))}
        aria-label="Озвучка"
        className="rounded-lg border border-white/10 bg-black/70 px-2.5 py-1.5 text-xs font-medium text-gray-100 backdrop-blur focus:border-accent focus:outline-none"
      >
        {translations.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
    </div>
  );

  if (loadState === 'probing') {
    return (
      <div className="skeleton relative flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl">
        {translationSelector}
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-accent" />
        <span className="text-sm text-gray-500">Извлекаем видео из {SOURCE_LABELS[effectiveSource]}…</span>
      </div>
    );
  }

  if (loadState === 'unavailable') {
    return (
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl bg-bg-card p-6 text-center ring-1 ring-white/10">
        {translationSelector}
        <div className="text-4xl">📡</div>
        <p className="text-sm font-medium text-gray-200">Эта серия недоступна в нашем плеере</p>
        <p className="max-w-md text-xs leading-relaxed text-gray-400">
          У источника {SOURCE_LABELS[effectiveSource]} нет этой серии — попробуйте другой плеер выше.
        </p>
      </div>
    );
  }

  if (loadState === 'failed') {
    return (
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl bg-bg-card p-6 text-center ring-1 ring-white/10">
        {translationSelector}
        <p className="text-sm text-gray-200">Не удалось загрузить видео.</p>
        <button
          type="button"
          onClick={retry}
          className="press rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Повторить
        </button>
      </div>
    );
  }

  const dur = duration ?? 0;
  const nearEnd =
    nextHref !== null && dur > 0 && (isEnded || dur - currentTime <= NEXT_BUTTON_WINDOW_S);
  const progressPct = dur > 0 ? (currentTime / dur) * 100 : 0;
  const bufferedPct = dur > 0 ? Math.min(100, (buffered / dur) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseMove={showControls}
        onTouchStart={showControls}
        className="group relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 outline-none focus:ring-accent/40"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          preload="metadata"
          poster={posterUrl ?? undefined}
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          className="absolute inset-0 h-full w-full"
        />

        {translationSelector}

        {buffering && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        )}

        {!playing && !buffering && !isEnded && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Смотреть"
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80">
              <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8 fill-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}

        {activeSkip && (
          <button
            type="button"
            onClick={skipCurrent}
            className="absolute bottom-20 right-3 z-10 rounded-lg bg-black/80 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/95"
          >
            {activeSkip === 'opening' ? 'Пропустить опенинг' : 'Пропустить титры'} →
          </button>
        )}

        {nearEnd && !activeSkip && nextHref && (
          <Link
            href={nextHref}
            className="absolute bottom-20 right-3 z-10 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-accent-hover"
          >
            {nextLabel ?? 'Следующая серия'} →
          </Link>
        )}

        <div
          className={[
            'absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2 pt-8 transition-opacity duration-300',
            controlsVisible || !playing ? 'opacity-100' : 'pointer-events-none opacity-0',
          ].join(' ')}
        >
          <input
            type="range"
            min={0}
            max={dur || 0}
            step={0.1}
            value={Math.min(currentTime, dur || 0)}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Перемотка"
            disabled={!dur}
            className="player-range h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none"
            style={{
              background: `linear-gradient(to right, #2997ff ${progressPct}%, rgba(255,255,255,0.45) ${progressPct}%, rgba(255,255,255,0.45) ${bufferedPct}%, rgba(255,255,255,0.18) ${bufferedPct}%)`,
            }}
          />

          <div className="flex items-center gap-1 text-white sm:gap-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Пауза' : 'Смотреть'}
              className="rounded-md p-1.5 transition hover:bg-white/10"
            >
              {playing ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBy(-10)}
              aria-label="Назад 10 секунд"
              className="rounded-md p-1.5 text-xs font-semibold transition hover:bg-white/10"
            >
              −10
            </button>
            <button
              type="button"
              onClick={() => seekBy(10)}
              aria-label="Вперёд 10 секунд"
              className="rounded-md p-1.5 text-xs font-semibold transition hover:bg-white/10"
            >
              +10
            </button>

            <span className="ml-1 text-xs tabular-nums text-gray-200">
              {formatTime(currentTime)}
              {dur > 0 && ` / ${formatTime(dur)}`}
            </span>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => applyVolume(muted || volume === 0 ? 0.5 : 0)}
              aria-label={muted ? 'Включить звук' : 'Выключить звук'}
              className="rounded-md p-1.5 transition hover:bg-white/10"
            >
              {muted || volume === 0 ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v2.2l2.45 2.45c.03-.21.05-.43.05-.65zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4-.91 7-4.49 7-8.77s-3-7.86-7-8.77z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => applyVolume(Number(e.target.value))}
              aria-label="Громкость"
              className="player-range hidden h-1 w-20 cursor-pointer appearance-none rounded-full sm:block"
              style={{
                background: `linear-gradient(to right, #fff ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.25) ${(muted ? 0 : volume) * 100}%)`,
              }}
            />

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
              className="rounded-md p-1.5 transition hover:bg-white/10"
            >
              {fullscreen ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300">
          Наш плеер · {SOURCE_LABELS[effectiveSource]}
        </span>
      </div>
    </div>
  );
}

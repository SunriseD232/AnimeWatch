'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { formatTime } from '@/lib/format';
import type { ContentType } from '@/lib/types';
import type { ExtractSource, Subtitle } from '@/lib/extract/types';
import type { YummyTranslation } from '@/lib/video/yummy';
import type HlsType from 'hls.js';
import type { MediaPlayerClass } from 'dashjs';

interface SkipSegment {
  time: number;
  length: number;
}

interface QualityLevel {
  /** Индекс уровня в hls.levels — то, что подставляется в hls.currentLevel. */
  index: number;
  height: number;
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
  /** То же самое, но по id — для кино (Videoseed/Kodik) id озвучки стабилен
   *  и между сериями, и между визитами (в отличие от Yummy у аниме), поэтому
   *  надёжнее строкового сопоставления по названию: не ломается, если
   *  каталог чуть переименует/переформатирует подпись озвучки. Пробуем
   *  ПЕРВЫМ (только contentType==='cinema' — у аниме этот id нестабилен). */
  savedTranslationId?: number | null;
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
  kodik: 'Kodik',
  cvh: 'CVH',
  aksor: 'Aksor',
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
  savedTranslationId,
  skipOpening,
  skipEnding,
  nextHref,
  nextLabel,
  onEnded,
  onTimeUpdate,
}: Props) {
  // Выбор озвучки: сперва пробуем сохранённую по id (только кино — там он
  // стабилен, см. Props.savedTranslationId), затем по названию (аниме —
  // video_id Yummy меняется от серии к серии, см. миграцию 0008), иначе
  // первую из списка.
  const [translationId, setTranslationId] = useState<number | null>(() => {
    const savedById =
      contentType === 'cinema' && savedTranslationId != null
        ? translations.find((t) => t.id === savedTranslationId)
        : undefined;
    const savedByTitle = initialTranslationTitle
      ? translations.find((t) => t.title === initialTranslationTitle)
      : undefined;
    return savedById?.id ?? savedByTitle?.id ?? translations[0]?.id ?? null;
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
  // Aksor — единственный DASH-источник: качество там не ABR-уровень внутри
  // одного манифеста (как у HLS), а отдельный .mpd на каждую высоту (см.
  // ResolvedStream.qualities/rewriteDashManifest) — поэтому смена качества
  // идёт через query-параметр ?q=, который меняет src и перезагружает
  // источник (как смена озвучки), а не через currentLevel без перезагрузки.
  const isDashSource = effectiveSource === 'aksor';
  const [dashQualityHeight, setDashQualityHeight] = useState<number | null>(null);

  const query = new URLSearchParams();
  if (translationId != null) query.set('t', String(translationId));
  if (dashQualityHeight != null) query.set('q', String(dashQualityHeight));
  const queryStr = query.toString();
  const src = `/api/proxy/${contentType}/${shikimoriId}/${season}/${episode}/${effectiveSource}${
    queryStr ? `?${queryStr}` : ''
  }`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const dashRef = useRef<MediaPlayerClass | null>(null);
  // Content-Type из проверочного HEAD (см. эффект резолва ниже) — переносится
  // во второй эффект (подключение к <video>), чтобы не запрашивать HEAD дважды.
  const upstreamContentTypeRef = useRef<string | null>(null);
  // X-Video-Qualities из того же HEAD (см. /api/proxy/.../route.ts) — список
  // доступных высот DASH через запятую, читаем один раз вместо отдельного
  // запроса (у HLS вместо этого — hls.js сам парсит master.m3u8).
  const dashQualitiesRef = useRef<string | null>(null);
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
  // Уровни качества из hls.js (только для HLS-источников с несколькими
  // вариантами в master.m3u8 — иначе список пуст, и селектор скрыт).
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1); // -1 = авто (ABR)
  // Субтитры — отдельная ручка (не часть m3u8/mp4), см. /api/proxy/subtitles.
  // Сейчас реально отдаёт только Videoseed — для остальных источников список
  // всегда пуст, и селектор просто не рендерится.
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number | null>(null); // null = выкл

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
  // Читаем сохранённое значение сразу (до монтирования <video> — он рисуется
  // только в ветке loadState==='ready', см. ниже), применяем к самому
  // элементу отдельным эффектом ниже, когда он реально появится в DOM.
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) {
      setVolume(stored);
      setMuted(stored === 0);
    }
  }, []);

  // <video> монтируется только при loadState==='ready' — до этого момента
  // videoRef.current пуст, и присвоение volume/muted в эффекте восстановления
  // выше молча не срабатывает (сам элемент по умолчанию volume=1). Синхронно
  // применяем текущие volume/muted, как только элемент реально появляется.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

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

  // seekTargetRef сбрасываем к серверному resumeFrom ТОЛЬКО при смене
  // серии/сезона (реальная навигация) — НЕ при каждой смене src, иначе это
  // затирает то, что только что выставили changeTranslation()/retry() (текущая
  // позиция при смене озвучки или повторе), и переключение дорожки на
  // середине просмотра откатывало бы на изначальную точку резюма вместо
  // продолжения с того же места.
  useEffect(() => {
    seekTargetRef.current = resumeFrom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, season, resumeFrom]);

  // Явно выбранное DASH-качество (Aksor) не переносится между сериями и
  // сменой озвучки — новый эпизод/дорожка снова стартует с лучшего качества
  // по умолчанию (см. src выше — dashQualityHeight===null означает "без ?q=").
  useEffect(() => {
    setDashQualityHeight(null);
  }, [episode, translationId]);

  // --- Определение типа потока (HLS/mp4) и подключение источника -----------
  useEffect(() => {
    let cancelled = false;
    setLoadState('probing');
    setBuffering(true);
    setIsEnded(false);

    (async () => {
      let contentType: string | null = null;
      let ok = false;
      try {
        const res = await fetch(src, { method: 'HEAD' });
        ok = res.ok;
        contentType = res.headers.get('content-type');
        dashQualitiesRef.current = res.headers.get('x-video-qualities');
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
      if (dashRef.current) {
        dashRef.current.destroy();
        dashRef.current = null;
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
      const upstreamType = upstreamContentTypeRef.current ?? '';
      const isHls = upstreamType.includes('mpegurl');
      const isDash = upstreamType.includes('dash+xml');
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (dashRef.current) {
        dashRef.current.destroy();
        dashRef.current = null;
      }
      setQualityLevels([]);
      setCurrentLevel(-1);

      if (isHls) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hlsRef.current = hls;
          // master.m3u8 может содержать несколько ABR-вариантов (см. §12
          // ARCHITECTURE.md) — показываем выбор только когда их больше одного,
          // иначе (как сейчас почти всегда у Alloha — один уровень) селектор
          // просто не рендерится.
          hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
            if (cancelled) return;
            const levels = data.levels
              .map((lvl, index) => ({ index, height: lvl.height }))
              .filter((l) => l.height > 0)
              .sort((a, b) => b.height - a.height);
            setQualityLevels(levels);
            setCurrentLevel(hls.currentLevel);
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
            if (!cancelled) setCurrentLevel(data.level);
          });
          hls.loadSource(src);
          hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = src; // Safari/iOS — нативный HLS, свой выбор качества
        }
      } else if (isDash) {
        const { MediaPlayer } = await import('dashjs');
        if (cancelled) return;
        const player = MediaPlayer().create();
        dashRef.current = player;
        // Качества Aksor — отдельные .mpd (см. ResolvedStream.qualities), не
        // ABR-варианты внутри одного манифеста — список высот пришёл вместе
        // с HEAD-пробой (X-Video-Qualities, см. эффект резолва выше), не из
        // самого dash.js/манифеста.
        const heights = (dashQualitiesRef.current ?? '')
          .split(',')
          .map((h) => Number(h))
          .filter((h) => Number.isFinite(h) && h > 0)
          .sort((a, b) => b - a);
        if (heights.length > 1) {
          const levels = heights.map((height, index) => ({ index, height }));
          setQualityLevels(levels);
          const activeHeight = dashQualityHeight ?? heights[0];
          const activeIndex = levels.findIndex((l) => l.height === activeHeight);
          setCurrentLevel(activeIndex >= 0 ? activeIndex : 0);
        }
        player.initialize(video, src, true);
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
      if (dashRef.current) {
        dashRef.current.destroy();
        dashRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, reloadKey, loadState]);

  // --- Субтитры: отдельный запрос, только после того, как основной резолв
  // видео уже сходил на VPS (loadState==='ready') — иначе гонка с ним даёт
  // ДВА параллельных извлечения одной и той же серии вместо одного (VPS
  // слабый, 1ГБ RAM, лишний Puppeteer-прогон ни к чему). К тому моменту
  // resolveStream уже закэширован тем первым запросом, так что этот —
  // обычно просто попадание в кэш. -----------------------------------------
  useEffect(() => {
    if (loadState !== 'ready') {
      setSubtitles([]);
      setActiveSubtitleIndex(null);
      return;
    }
    let cancelled = false;
    const subsUrl = `/api/proxy/subtitles/${contentType}/${shikimoriId}/${season}/${episode}/${effectiveSource}${
      translationId != null ? `?t=${translationId}` : ''
    }`;
    fetch(subsUrl)
      .then((r) => (r.ok ? r.json() : { subtitles: [] }))
      .then((data: { subtitles?: Subtitle[] }) => {
        if (!cancelled) setSubtitles(Array.isArray(data.subtitles) ? data.subtitles : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, src]);

  // Применяем выбор дорожки к нативным <track> — по индексу, не по языку
  // (проще и надёжнее сопоставления, дублей lang не бывает в рамках одной
  // серии/озвучки).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = i === activeSubtitleIndex ? 'showing' : 'hidden';
    }
  }, [activeSubtitleIndex, subtitles]);

  // --- События <video> -------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Идемпотентно — можно дёргать из нескольких событий подряд (см. ниже),
    // не только из loadedmetadata: если тот сработал раньше, чем реально
    // применился seek (например, до готовности буфера у HLS), повтор на
    // canplay/playing подхватит пропущенный сброс, а не оставит с позиции 0.
    const applyResumeSeek = () => {
      const target = seekTargetRef.current;
      if (target == null || target <= 1) return;
      if (Number.isFinite(video.duration) && target >= video.duration) return;
      if (Math.abs(video.currentTime - target) > 1) {
        video.currentTime = target;
      }
      seekTargetRef.current = null;
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      applyResumeSeek();
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
    const onCanPlay = () => {
      setBuffering(false);
      applyResumeSeek();
    };
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

  // Смена качества — hls.js переключает уровень на лету, без перезагрузки
  // src и без потери позиции (в отличие от смены серии/озвучки).
  const changeQuality = useCallback(
    (index: number) => {
      if (hlsRef.current) {
        hlsRef.current.currentLevel = index;
        setCurrentLevel(index);
        return;
      }
      // DASH (Aksor): качество — отдельный манифест (?q=<height>), а не
      // ABR-уровень внутри одного, как у hls.js — меняем src через
      // dashQualityHeight, что перезапускает резолв (как смена озвучки),
      // сохраняя позицию через seekTargetRef (см. фикс выше).
      const lvl = qualityLevels[index];
      if (!lvl) return;
      seekTargetRef.current = currentTime > 1 ? currentTime : resumeFrom;
      setDashQualityHeight(lvl.height);
      setCurrentLevel(index);
    },
    [qualityLevels, currentTime, resumeFrom],
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
        >
          {/* mode ('showing'/'hidden') выставляется отдельным эффектом по
              activeSubtitleIndex — default тут не нужен и может конфликтовать
              с этим эффектом при первом монтировании. */}
          {subtitles.map((s) => (
            <track key={s.lang} kind="subtitles" src={s.url} srcLang={s.lang} label={s.label} />
          ))}
        </video>

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
        {qualityLevels.length > 1 && (
          <>
            <span className="ml-1 text-gray-400">Качество:</span>
            {!isDashSource && (
              <button
                type="button"
                onClick={() => changeQuality(-1)}
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition',
                  currentLevel === -1
                    ? 'bg-accent text-white'
                    : 'bg-bg-card text-gray-200 hover:bg-bg-soft',
                ].join(' ')}
              >
                Авто
              </button>
            )}
            {qualityLevels.map((lvl) => (
              <button
                key={lvl.index}
                type="button"
                onClick={() => changeQuality(lvl.index)}
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition',
                  currentLevel === lvl.index
                    ? 'bg-accent text-white'
                    : 'bg-bg-card text-gray-200 hover:bg-bg-soft',
                ].join(' ')}
              >
                {lvl.height}p
              </button>
            ))}
          </>
        )}
        {subtitles.length > 0 && (
          <>
            <span className="ml-1 text-gray-400">Субтитры:</span>
            <button
              type="button"
              onClick={() => setActiveSubtitleIndex(null)}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                activeSubtitleIndex === null
                  ? 'bg-accent text-white'
                  : 'bg-bg-card text-gray-200 hover:bg-bg-soft',
              ].join(' ')}
            >
              Выкл
            </button>
            {subtitles.map((s, i) => (
              <button
                key={s.lang}
                type="button"
                onClick={() => setActiveSubtitleIndex(i)}
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition',
                  activeSubtitleIndex === i
                    ? 'bg-accent text-white'
                    : 'bg-bg-card text-gray-200 hover:bg-bg-soft',
                ].join(' ')}
              >
                {s.label}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

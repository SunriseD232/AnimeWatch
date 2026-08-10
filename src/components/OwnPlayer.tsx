'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { formatTime } from '@/lib/format';
import type { ContentType } from '@/lib/types';
import type { ExtractSource, Subtitle } from '@/lib/extract/types';
import type { YummyTranslation } from '@/lib/video/yummy';
import type HlsType from 'hls.js';
import type { MediaPlayerClass } from 'dashjs';
import { ExternalDisplay } from '@/native/externalDisplay';

interface SkipSegment {
  time: number;
  length: number;
}

/** WebKit-only Picture-in-Picture API (Safari — нет стандартного
 *  document.pictureInPictureEnabled/requestPictureInPicture у iOS). */
interface WebkitPipVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: 'picture-in-picture') => boolean;
  webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void;
  webkitPresentationMode?: 'picture-in-picture' | 'inline' | 'fullscreen';
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
  /** Если задан — клик по «Следующая серия» вызывает это вместо перехода по
   *  nextHref (бесшовное переключение без полной навигации, см.
   *  Player.tsx/WatchPlayer.tsx switchEpisode). nextHref всё равно нужен —
   *  используется как fallback-адрес и для отображения. */
  onNext?: () => void;
  onEnded: () => void;
  /** Сообщает текущую позицию (и, когда известна, длительность файла — она
   *  не приходит ни от одного источника заранее, только из самого <video>)
   *  наверх — для переноса при смене источника и для прогрева следующей
   *  серии ближе к концу текущей. */
  onTimeUpdate?: (seconds: number, duration: number | null) => void;
  /** Сообщает о входе/выходе из Picture-in-Picture — используется PipPlayerHost
   *  (см. components/pip/PipPlayerHost.tsx), чтобы решить, можно ли безопасно
   *  убрать этот плеер из документа при уходе со страницы (нельзя, пока PiP
   *  активен — иначе браузер сам закроет плавающее окно). */
  onPipChange?: (active: boolean) => void;
}

const VOLUME_KEY = 'aw:ownPlayerVolume';
const SPEED_KEY = 'aw:ownPlayerSpeed';
const NEXT_BUTTON_WINDOW_S = 45;
const CONTROLS_HIDE_MS = 3_000;
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const SOURCE_LABELS: Record<ExtractSource, string> = {
  alloha: 'Alloha',
  videoseed: 'Videoseed',
  sibnet: 'Sibnet',
  kodik: 'Kodik',
  cvh: 'CVH',
  aksor: 'Aksor',
};

type LoadState = 'probing' | 'ready' | 'unavailable' | 'failed';
// Меню настроек — корневой список категорий или подменю выбора значения для
// одной из них (см. рендер в конце компонента).
type SettingsView = 'root' | 'quality' | 'audio' | 'subtitles' | 'speed';

const SETTINGS_VIEW_TITLES: Record<Exclude<SettingsView, 'root'>, string> = {
  quality: 'Качество',
  audio: 'Озвучка',
  subtitles: 'Субтитры',
  speed: 'Скорость',
};

function speedLabel(rate: number): string {
  return rate === 1 ? 'Обычная' : `${rate}×`;
}

/** Строка корневого меню настроек: категория + текущее значение + шеврон. */
function SettingsRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition hover:bg-white/10"
    >
      <span className="text-gray-200">{label}</span>
      <span className="flex items-center gap-1 text-xs text-gray-400">
        <span className="max-w-[8rem] truncate">{value}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current">
          <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
        </svg>
      </span>
    </button>
  );
}

/** Пункт подменю (значение категории) — радио-кружок + подпись. */
function RadioOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-white/10"
    >
      <span
        className={[
          'inline-block h-3.5 w-3.5 shrink-0 rounded-full border',
          active ? 'border-accent bg-accent' : 'border-white/30',
        ].join(' ')}
      />
      <span className={active ? 'text-accent' : 'text-gray-200'}>{label}</span>
    </button>
  );
}

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
  onNext,
  onEnded,
  onTimeUpdate,
  onPipChange,
}: Props) {
  const onPipChangeRef = useRef(onPipChange);
  onPipChangeRef.current = onPipChange;
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
  // Счётчик подряд идущих фатальных network-ошибок hls.js в рамках ТЕКУЩЕГО
  // подключения — см. Hls.Events.ERROR ниже. Сбрасывается на каждый новый
  // коннект (новый src/reloadKey) и на успешный MANIFEST_PARSED.
  const hlsErrorRecoveryRef = useRef(0);
  // Content-Type из проверочного HEAD (см. эффект резолва ниже) — переносится
  // во второй эффект (подключение к <video>), чтобы не запрашивать HEAD дважды.
  const upstreamContentTypeRef = useRef<string | null>(null);
  // X-Video-Qualities из того же HEAD (см. /api/proxy/.../route.ts) — список
  // доступных высот DASH через запятую, читаем один раз вместо отдельного
  // запроса (у HLS вместо этого — hls.js сам парсит master.m3u8).
  const dashQualitiesRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const seekTargetRef = useRef<number | null>(resumeFrom);
  // Пытались ли уже запустить автовоспроизведение на ЭТОМ подключении — см.
  // attemptPlay ниже. Сбрасывается вместе с остальными per-connection ref'ами
  // в эффекте резолва источника.
  const autoplayTriedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const skipOpeningRef = useRef(skipOpening);
  skipOpeningRef.current = skipOpening;
  const skipEndingRef = useRef(skipEnding);
  skipEndingRef.current = skipEnding;
  // Автопропуск опенинга/титров (см. onTime и performAutoSkip ниже): true —
  // пользователь нажал «Смотреть», для этой серии сегмент больше не
  // пропускаем автоматически. Сбрасываются при смене серии/сезона.
  const optedInOpeningRef = useRef(false);
  const optedInEndingRef = useRef(false);
  // Текущая зона (внутри сегмента или нет) — нужна, чтобы ловить именно
  // МОМЕНТ входа в сегмент (единожды), а не решать на каждом тике timeupdate,
  // пока играем внутри уже пропущенного/просматриваемого сегмента.
  const inSkipZoneRef = useRef<'opening' | 'ending' | null>(null);
  const recentlySkippedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [playbackRate, setPlaybackRate] = useState(1);
  // Свежее значение скорости — для повторного применения на loadedmetadata
  // (см. onLoadedMetadata ниже): hls.js на каждом attachMedia/новом манифесте
  // сам сбрасывает video.playbackRate обратно на 1, поэтому применять его
  // только один раз при первом монтировании (как раньше) недостаточно — на
  // следующей серии/переподключении сброс происходит ПОСЛЕ того разового
  // применения, и реально проигрывается всегда на обычной скорости, хотя
  // выбранное значение в меню настроек остаётся видно как выбранное.
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  // Поддержка Picture-in-Picture — определяем на клиенте (document
  // недоступен при SSR), кнопка скрыта, пока не узнаем точно (Firefox/старые
  // браузеры/видео с disablePictureInPicture — не показываем совсем).
  const [pipSupported, setPipSupported] = useState(false);
  // Внешний экран (очки Xreal через USB-C DisplayPort) — есть только в
  // нативной iOS-обёртке (Capacitor), см. src/native/externalDisplay.ts и
  // ios/App/App/ExternalDisplayManager.swift. На обычном вебе
  // Capacitor.isNativePlatform() === false, и это состояние всегда false.
  const [externalScreenConnected, setExternalScreenConnected] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  // Сегмент, который только что автопропустили — показываем тост «Опенинг
  // пропущен · Смотреть» на несколько секунд (см. performAutoSkip/watchSkip).
  const [recentlySkipped, setRecentlySkipped] = useState<'opening' | 'ending' | null>(null);
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
  // Меню качества/субтитров — внутри контейнера фуллскрина (см. containerRef
  // ниже), а не отдельным блоком под видео: снаружи он был недоступен в
  // полноэкранном режиме (фуллскрин берётся на containerRef, а не на всю
  // страницу).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('root');

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

  // --- Скорость: восстановление сохранённого значения ------------------------
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SPEED_KEY));
    if (PLAYBACK_RATES.includes(stored)) {
      setPlaybackRate(stored);
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
    v.playbackRate = playbackRate;
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

  // Выбор «Смотреть» (не пропускать опенинг/титры автоматически) — только на
  // текущую серию, новая серия снова стартует с автопропуском по умолчанию.
  useEffect(() => {
    optedInOpeningRef.current = false;
    optedInEndingRef.current = false;
    inSkipZoneRef.current = null;
    if (recentlySkippedTimeoutRef.current) {
      clearTimeout(recentlySkippedTimeoutRef.current);
      recentlySkippedTimeoutRef.current = null;
    }
    setRecentlySkipped(null);
  }, [episode, season]);

  // Явно выбранное DASH-качество (Aksor) не переносится между сериями и
  // сменой озвучки — новый эпизод/дорожка снова стартует с лучшего качества
  // по умолчанию (см. src выше — dashQualityHeight===null означает "без ?q=").
  useEffect(() => {
    setDashQualityHeight(null);
  }, [episode, translationId]);

  // Закрываем меню настроек при смене серии/сезона — иначе может остаться
  // открытым поверх уже другой серии после навигации. Возвращаем и на
  // корневой список категорий, а не в оставшееся открытым подменю. Смена
  // озвучки/качества САМИ закрывают меню в своих обработчиках (см.
  // RadioOption ниже) — раньше это дублировалось эффектом по [src], но src
  // пересчитывается и на «фоновом» уточнении translationId сразу после
  // монтирования (до первого реального выбора пользователя), и тогда этот
  // эффект гасил меню, только что открытое кликом по «Настройки» — первый
  // клик после захода на страницу выглядел так, будто ничего не произошло.
  useEffect(() => {
    setSettingsOpen(false);
    setSettingsView('root');
  }, [episode, season]);

  // --- Определение типа потока (HLS/mp4) и подключение источника -----------
  useEffect(() => {
    let cancelled = false;
    setLoadState('probing');
    setBuffering(true);
    setIsEnded(false);
    autoplayTriedRef.current = false;

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
          // startPosition — иначе hls.js по умолчанию начинает буферизацию
          // с начала потока и только ПОСЛЕ loadedmetadata мы переставляем
          // currentTime на сохранённую позицию (см. applyResumeSeek ниже):
          // первый сегмент у нулевой секунды скачивается зря, а нужный —
          // уже вторым заходом. При старте с нуля этой лишней работы нет,
          // поэтому возобновление с середины ощутимо дольше. startPosition
          // сразу нацеливает hls.js на нужный сегмент с первого запроса.
          const target = seekTargetRef.current;
          const hls = new Hls({
            enableWorker: true,
            startPosition: target && target > 1 ? target : -1,
          });
          hlsRef.current = hls;
          hlsErrorRecoveryRef.current = 0;
          // master.m3u8 может содержать несколько ABR-вариантов (см. §12
          // ARCHITECTURE.md) — показываем выбор только когда их больше одного,
          // иначе (как сейчас почти всегда у Alloha — один уровень) селектор
          // просто не рендерится.
          hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
            if (cancelled) return;
            hlsErrorRecoveryRef.current = 0;
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
          // Без этого обработчика фатальная ошибка hls.js (протухшая
          // подписанная ссылка на сегмент, сетевой сбой) молча вешала плеер
          // намертво: буфер доигрывался до конца, дальше ничего не грузилось
          // и не менялось, обычный reload не помогал (сервер отдавал тот же
          // закэшированный URL), помогала только полная пересборка через
          // смену серии и возврат обратно — то же самое делает retry() ниже.
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (cancelled || !data.fatal) return;
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hlsErrorRecoveryRef.current += 1;
                if (hlsErrorRecoveryRef.current <= 2) {
                  hls.startLoad();
                } else {
                  retryRef.current();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setLoadState('failed');
                break;
            }
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

  // Автопропуск: молча перематывает за сегмент и показывает тост-отмену на
  // несколько секунд («Опенинг пропущен · Смотреть», см. watchSkip ниже) —
  // используется из обработчика timeupdate ниже, поэтому объявлен раньше.
  const performAutoSkip = useCallback((type: 'opening' | 'ending', segment: SkipSegment) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = segment.time + segment.length;
    setRecentlySkipped(type);
    if (recentlySkippedTimeoutRef.current) clearTimeout(recentlySkippedTimeoutRef.current);
    recentlySkippedTimeoutRef.current = setTimeout(() => {
      recentlySkippedTimeoutRef.current = null;
      setRecentlySkipped(null);
    }, 8_000);
  }, []);

  // «Смотреть» на тосте — отматывает назад к началу сегмента и отключает
  // автопропуск для него на оставшуюся часть ЭТОЙ серии (сброс — см. эффект
  // выше по [episode, season]).
  const watchSkip = useCallback(() => {
    if (!recentlySkipped) return;
    const segment =
      recentlySkipped === 'opening' ? skipOpeningRef.current : skipEndingRef.current;
    if (recentlySkipped === 'opening') optedInOpeningRef.current = true;
    else optedInEndingRef.current = true;
    if (recentlySkippedTimeoutRef.current) {
      clearTimeout(recentlySkippedTimeoutRef.current);
      recentlySkippedTimeoutRef.current = null;
    }
    setRecentlySkipped(null);
    const v = videoRef.current;
    if (v && segment) v.currentTime = segment.time;
  }, [recentlySkipped]);

  // --- События <video> -------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Идемпотентно — можно дёргать из нескольких событий подряд (см. ниже),
    // не только из loadedmetadata: если тот сработал раньше, чем реально
    // применился seek (например, до готовности буфера у HLS), повтор на
    // canplay/playing подхватит пропущенный сброс, а не оставит с позиции 0.
    // seekPending — сик на сохранённую позицию реально запущен, но браузер
    // ещё не отчитался о его завершении (событие seeked ниже): canplay не
    // гарантирует, что к этому моменту сик уже доехал (замечено вживую —
    // воспроизведение стартовало ДО применения позиции, будто плеер ещё не
    // успел загрузиться). attemptPlay ждёт seekPending, чтобы не запускать
    // play() поверх ещё не завершённой перемотки.
    let seekPending = false;
    const applyResumeSeek = () => {
      const target = seekTargetRef.current;
      if (target == null || target <= 1) return;
      if (Number.isFinite(video.duration) && target >= video.duration) {
        seekTargetRef.current = null;
        return;
      }
      seekTargetRef.current = null;
      if (Math.abs(video.currentTime - target) > 1) {
        seekPending = true;
        video.currentTime = target;
      }
    };
    // Запускаем воспроизведение сами (вместо атрибута autoPlay на <video>,
    // см. ниже) — так у нас есть доступ к промису play() и можно поймать
    // отказ. Браузеры блокируют автовоспроизведение СО ЗВУКОМ без
    // достаточной истории вовлечённости (Media Engagement Index у Chrome,
    // ещё строже у Safari/Firefox) — раньше play() тихо отклонялся, ничего
    // не сообщая (ни ошибки, ни события), и плеер выглядел «зависшим», пока
    // не ткнуть play руками. Отказ на звуке почти всегда чинится повтором
    // БЕЗ звука — это браузеры разрешают практически всегда — с явным
    // индикатором «выкл. звук» в панели, который и так уже есть.
    const attemptPlay = () => {
      if (autoplayTriedRef.current || seekPending) return;
      autoplayTriedRef.current = true;
      video.play().catch(() => {
        video.muted = true;
        setMuted(true);
        video.play()
          .then(() => {
            // Мьют был нужен только чтобы обойти политику браузера на
            // старте — как только воспроизведение реально пошло, браузеры
            // не блокируют возврат звука у УЖЕ играющего видео (в отличие
            // от запуска сразу со звуком), поэтому сразу возвращаем
            // сохранённую громкость, а не оставляем висеть на «выкл. звук»
            // в ожидании ручного клика.
            video.muted = false;
            setMuted(false);
          })
          .catch(() => {
            // Не запустилось даже без звука — оставляем на паузе, кнопка
            // «Смотреть» по центру уже показывает, что нужно нажать.
          });
      });
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      video.playbackRate = playbackRateRef.current;
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
      onTimeUpdateRef.current?.(t, Number.isFinite(video.duration) ? video.duration : null);
      const op = skipOpeningRef.current;
      const end = skipEndingRef.current;
      let zone: 'opening' | 'ending' | null = null;
      let segment: SkipSegment | null = null;
      if (op && t >= op.time && t < op.time + op.length) {
        zone = 'opening';
        segment = op;
      } else if (end && t >= end.time && t < end.time + end.length) {
        zone = 'ending';
        segment = end;
      }
      // Реагируем только на МОМЕНТ входа в сегмент, не на каждый тик, пока мы
      // уже внутри — иначе автопропуск (или отказ от него через «Смотреть»)
      // бы повторно решался на каждом timeupdate.
      if (zone !== inSkipZoneRef.current) {
        inSkipZoneRef.current = zone;
        const optedIn = zone === 'opening' ? optedInOpeningRef.current : optedInEndingRef.current;
        if (zone && segment && !optedIn) {
          performAutoSkip(zone, segment);
        }
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
    // Перемотка вперёд, а затем назад (например, глянуть кусок серии дальше
    // и вернуться досматривать с прерванного места) оставляет между старым
    // и новым буферизованными участками несколько секунд без данных — не
    // «дыра с нуля» (там ждать нормально), а именно разрыв МЕЖДУ двумя уже
    // подгруженными кусками. hls.js обычно сам перепрыгивает такие разрывы,
    // но не всегда достаточно быстро — воспроизведено вживую: видео зависало
    // на несколько секунд/дольше, доходя ровно до места, откуда до этого
    // перематывали назад. watchdog — если застряли в waiting дольше 2.5с и
    // впереди (в пределах 20с) уже есть буферизованный участок — прыгаем в
    // его начало сами, не дожидаясь неопределённо долго.
    let gapWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const clearGapWatchdog = () => {
      if (gapWatchdogTimer) {
        clearTimeout(gapWatchdogTimer);
        gapWatchdogTimer = null;
      }
    };
    const onWaiting = () => {
      setBuffering(true);
      clearGapWatchdog();
      gapWatchdogTimer = setTimeout(() => {
        gapWatchdogTimer = null;
        if (video.readyState >= 3 || video.paused) return;
        const b = video.buffered;
        const t = video.currentTime;
        for (let i = 0; i < b.length; i++) {
          const start = b.start(i);
          if (start > t && start - t < 20) {
            video.currentTime = start + 0.1;
            break;
          }
        }
      }, 2_500);
    };
    const onCanPlay = () => {
      setBuffering(false);
      clearGapWatchdog();
      applyResumeSeek();
      attemptPlay();
    };
    // Само событие завершения перемотки — снимаем seekPending и пробуем
    // запустить воспроизведение, если canplay уже отстрелялся раньше и
    // attemptPlay тогда молча вышел из-за незавершённого сика (см. выше).
    const onSeeked = () => {
      if (!seekPending) return;
      seekPending = false;
      attemptPlay();
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
    video.addEventListener('seeked', onSeeked);
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
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearGapWatchdog();
    };
  }, [save, onEnded, loadState, performAutoSkip]);

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

  // --- Picture-in-Picture ------------------------------------------------------
  // iOS Safari не поддерживает стандартный document.pictureInPictureEnabled/
  // video.requestPictureInPicture() вовсе — у него свой, WebKit-only API
  // (webkitSupportsPresentationMode/webkitSetPresentationMode). Без этой
  // ветки кнопка PiP на iPhone/iPad просто не показывалась (pipSupported
  // всегда false), хотя сам PiP там технически есть.
  useEffect(() => {
    const video = videoRef.current;
    const webkitVideo = video as WebkitPipVideoElement | null;
    setPipSupported(
      (typeof document !== 'undefined' && !!document.pictureInPictureEnabled) ||
        !!webkitVideo?.webkitSupportsPresentationMode?.('picture-in-picture'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  // video — новый DOM-узел на каждую серию (см. loadState probing→ready
  // выше, <video> размонтируется в промежуточных ветках) — переподвешиваем
  // слушатели вместе с ним, как и остальные обработчики <video> в этом файле.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => {
      setPip(true);
      onPipChangeRef.current?.(true);
    };
    const onLeave = () => {
      setPip(false);
      onPipChangeRef.current?.(false);
    };
    // Safari: нет enterpictureinpicture/leavepictureinpicture — вместо них
    // webkitpresentationmodechanged на самом видео, с состоянием в свойстве
    // webkitPresentationMode ('picture-in-picture' | 'inline' | 'fullscreen').
    const onPresentationModeChange = () => {
      const mode = (video as WebkitPipVideoElement).webkitPresentationMode;
      if (mode === 'picture-in-picture') onEnter();
      else onLeave();
    };
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    video.addEventListener('webkitpresentationmodechanged', onPresentationModeChange);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
      video.removeEventListener('webkitpresentationmodechanged', onPresentationModeChange);
    };
  }, [loadState]);

  const togglePip = useCallback(() => {
    const video = videoRef.current as WebkitPipVideoElement | null;
    if (!video) return;
    if (typeof video.webkitSetPresentationMode === 'function') {
      // Safari — без document.pictureInPictureElement, состояние читаем с
      // самого видео.
      video.webkitSetPresentationMode(
        video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture',
      );
      return;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      video.requestPictureInPicture().catch(() => {});
    }
  }, []);

  // --- Внешний экран (очки Xreal, только нативная iOS-обёртка) ---------------
  // Подписка на события плагина — один раз на весь срок жизни компонента (не
  // per-серию): сам факт подключения/отключения очков не связан со сменой
  // видео. На обычном вебе Capacitor.isNativePlatform() === false — весь блок
  // безопасный no-op, addListener на незарегистрированном под web-платформу
  // плагине в Capacitor не бросает исключение, но мы всё равно проверяем
  // платформу явно, чтобы не плодить лишние промисы на каждой загрузке сайта.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    ExternalDisplay.isExternalScreenConnected()
      .then(({ connected }) => {
        if (!cancelled) setExternalScreenConnected(connected);
      })
      .catch(() => {});
    const connectedHandle = ExternalDisplay.addListener('externalScreenConnected', () => {
      setExternalScreenConnected(true);
    });
    const disconnectedHandle = ExternalDisplay.addListener('externalScreenDisconnected', () => {
      setExternalScreenConnected(false);
    });
    return () => {
      cancelled = true;
      connectedHandle.then((h) => h.remove()).catch(() => {});
      disconnectedHandle.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  // Пока идёт воспроизведение на внешнем экране, локальное <video> ставим на
  // паузу и глушим (звук уже идёт с AVPlayer на стороне очков) — сам hls.js
  // при этом продолжает быть подключён как обычно (проще и безопаснее, чем
  // на время отключать его пайплайн, см. PLAN.md).
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !externalScreenConnected || loadState !== 'ready') return;
    const video = videoRef.current;
    if (video) video.pause();
    ExternalDisplay.play({
      url: new URL(src, window.location.origin).toString(),
      startPositionSeconds: video?.currentTime || resumeFrom || 0,
    }).catch(() => {});
    return () => {
      ExternalDisplay.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalScreenConnected, loadState, src]);

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

  const retry = useCallback(() => {
    seekTargetRef.current = currentTime > 1 ? currentTime : resumeFrom;
    setReloadKey((k) => k + 1);
  }, [currentTime, resumeFrom]);
  // retry() пересоздаётся на каждый тик currentTime (см. deps выше) — hls.js
  // ERROR-обработчик в эффекте подключения источника захватывает retry ОДИН
  // раз при коннекте и не видит более поздних версий, иначе после долгого
  // разрыва retry() откатывал бы позицию на момент коннекта, а не на момент
  // сбоя. retryRef всегда свежий — читаем именно его.
  const retryRef = useRef(retry);
  retryRef.current = retry;

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

  const changeSpeed = useCallback((rate: number) => {
    setPlaybackRate(rate);
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
    window.localStorage.setItem(SPEED_KEY, String(rate));
  }, []);

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
        <span className="text-sm text-gray-400">Извлекаем видео из {SOURCE_LABELS[effectiveSource]}…</span>
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
        onClick={() => {
          setSettingsOpen(false);
          setSettingsView('root');
        }}
        className="group relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 outline-none focus:ring-accent/40"
      >
        <video
          ref={videoRef}
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

        {/* Озвучка в ready-состоянии переехала в единое меню настроек ниже
            (см. Скорость/Качество/Субтитры) — translationSelector тут больше
            не рендерим, оставили его только для probing/unavailable/failed
            выше (возможность переключить озвучку до/после ошибки без него
            недоступна). */}

        {Capacitor.isNativePlatform() && externalScreenConnected && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/80 text-sm font-medium text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white">
              <path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-5v2h1a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h1v-2H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v8h14V8H5z" />
            </svg>
            Воспроизведение на очках
          </div>
        )}

        {buffering && !(Capacitor.isNativePlatform() && externalScreenConnected) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        )}

        {!playing && !buffering && !isEnded && !(Capacitor.isNativePlatform() && externalScreenConnected) && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Смотреть"
            // bottom-16, не inset-0: полное покрытие до самого низа перекрывало
            // кликабельную область панели управления (в частности, кнопку
            // «Настройки») — первый клик там иногда попадал на эту кнопку
            // (пауза/повторный play) вместо реального контрола под ней.
            className="absolute inset-x-0 top-0 bottom-16 flex items-center justify-center"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 ring-1 ring-white/20 backdrop-blur transition hover:bg-black/80">
              <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8 fill-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}

        {recentlySkipped && (
          <button
            type="button"
            onClick={watchSkip}
            className="absolute bottom-20 right-3 z-10 rounded-lg bg-black/80 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/95"
          >
            {recentlySkipped === 'opening' ? 'Опенинг пропущен · Смотреть' : 'Титры пропущены · Смотреть'}
          </button>
        )}

        {nearEnd && !recentlySkipped && nextHref && (
          onNext ? (
            <button
              type="button"
              onClick={onNext}
              className="absolute bottom-20 right-3 z-10 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-accent-hover"
            >
              {nextLabel ?? 'Следующая серия'} →
            </button>
          ) : (
            <Link
              href={nextHref}
              className="absolute bottom-20 right-3 z-10 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-accent-hover"
            >
              {nextLabel ?? 'Следующая серия'} →
            </Link>
          )
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

            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsOpen((v) => !v);
                }}
                aria-label="Настройки"
                className={[
                  'rounded-md p-1.5 transition hover:bg-white/10',
                  settingsOpen ? 'bg-white/10' : '',
                ].join(' ')}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.58-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.5.5 0 0 0-.58.22L2.74 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.14.24.44.34.68.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.28.27.42.5.42h3.84c.24 0 .46-.14.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.09.54 0 .68-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z" />
                </svg>
              </button>

              {settingsOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full right-0 z-20 mb-2 max-h-80 w-64 overflow-y-auto rounded-xl bg-black/90 p-1 text-sm text-white ring-1 ring-white/10 backdrop-blur"
                >
                  {settingsView === 'root' ? (
                    <>
                      {qualityLevels.length > 1 && (
                        <SettingsRow
                          label="Качество"
                          value={
                            currentLevel === -1
                              ? 'Авто'
                              : `${qualityLevels.find((l) => l.index === currentLevel)?.height ?? ''}p`
                          }
                          onClick={() => setSettingsView('quality')}
                        />
                      )}
                      {translations.length > 1 && (
                        <SettingsRow
                          label="Озвучка"
                          value={activeTranslation?.title ?? '—'}
                          onClick={() => setSettingsView('audio')}
                        />
                      )}
                      {subtitles.length > 0 && (
                        <SettingsRow
                          label="Субтитры"
                          value={
                            activeSubtitleIndex === null
                              ? 'Отключить'
                              : (subtitles[activeSubtitleIndex]?.label ?? '')
                          }
                          onClick={() => setSettingsView('subtitles')}
                        />
                      )}
                      <SettingsRow
                        label="Скорость"
                        value={speedLabel(playbackRate)}
                        onClick={() => setSettingsView('speed')}
                      />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setSettingsView('root')}
                        className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-300 hover:bg-white/10"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current">
                          <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                        </svg>
                        {SETTINGS_VIEW_TITLES[settingsView]}
                      </button>

                      {settingsView === 'quality' && (
                        <>
                          {!isDashSource && (
                            <RadioOption
                              label="Авто"
                              active={currentLevel === -1}
                              onClick={() => {
                                changeQuality(-1);
                                setSettingsOpen(false);
                              }}
                            />
                          )}
                          {qualityLevels.map((lvl) => (
                            <RadioOption
                              key={lvl.index}
                              label={`${lvl.height}p`}
                              active={currentLevel === lvl.index}
                              onClick={() => {
                                changeQuality(lvl.index);
                                setSettingsOpen(false);
                              }}
                            />
                          ))}
                        </>
                      )}

                      {settingsView === 'audio' &&
                        translations.map((t) => (
                          <RadioOption
                            key={t.id}
                            label={t.title}
                            active={t.id === translationId}
                            onClick={() => {
                              changeTranslation(t.id);
                              setSettingsOpen(false);
                            }}
                          />
                        ))}

                      {settingsView === 'subtitles' && (
                        <>
                          <RadioOption
                            label="Отключить"
                            active={activeSubtitleIndex === null}
                            onClick={() => {
                              setActiveSubtitleIndex(null);
                              setSettingsOpen(false);
                            }}
                          />
                          {subtitles.map((s, i) => (
                            <RadioOption
                              key={s.lang}
                              label={s.label}
                              active={activeSubtitleIndex === i}
                              onClick={() => {
                                setActiveSubtitleIndex(i);
                                setSettingsOpen(false);
                              }}
                            />
                          ))}
                        </>
                      )}

                      {settingsView === 'speed' &&
                        PLAYBACK_RATES.map((rate) => (
                          <RadioOption
                            key={rate}
                            label={speedLabel(rate)}
                            active={rate === playbackRate}
                            onClick={() => {
                              changeSpeed(rate);
                              setSettingsOpen(false);
                            }}
                          />
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {pipSupported && (
              <button
                type="button"
                onClick={togglePip}
                aria-label={
                  pip ? 'Выйти из режима «Картинка в картинке»' : 'Картинка в картинке'
                }
                className={[
                  'rounded-md p-1.5 transition hover:bg-white/10',
                  pip ? 'bg-white/10' : '',
                ].join(' ')}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5">
                  <rect
                    x="3"
                    y="5"
                    width="18"
                    height="14"
                    rx="2"
                    className="fill-none stroke-current"
                    strokeWidth="2"
                  />
                  <rect x="12" y="11" width="7" height="5" rx="1" className="fill-current" />
                </svg>
              </button>
            )}

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

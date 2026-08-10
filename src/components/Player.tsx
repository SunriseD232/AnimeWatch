'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import {
  KODIK_EVENTS,
  parseEpisode,
  type KodikMessage,
} from '@/lib/video/kodik-events';
import type { Translation } from '@/lib/video/types';
import type { VibixEmbed } from '@/lib/video/vibix';
import type { OwnPlayerTranslation } from '@/lib/extract/types';
import type { SeasonInfo } from '@/lib/videoseed-catalog';
import type { ContentType, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { useVideoseedEstimator } from '@/hooks/useVideoseedEstimator';
import VibixPlayer from '@/components/VibixPlayer';
import { usePipPlayerHost } from '@/components/pip/PipPlayerHost';

interface Props {
  shikimoriId: number;
  /** Тип контента — от него зависят ссылки и запись прогресса. */
  contentType: ContentType;
  /** Текущий сезон (для сериалов). Фильмы — 1. */
  season: number;
  episode: number;
  /** Список сезонов сериала (для навигации). Фильм — пустой. */
  seasons: SeasonInfo[];
  /** Число серий в текущем сезоне (для «Серия X из Y»). */
  total: number;
  animeTitle: string;
  posterUrl: string | null;
  /** Kodik embed (второстепенный плеер). */
  initialEmbedUrl: string;
  /** Vibix embed (основной плеер: точный трекинг позиции) или null. Один на
   *  весь тайтл — сезон/серия передаются прямо в VibixPlayer, без похода на
   *  сервер за новым embed при смене серии (см. switchEpisode). */
  vibixEmbed: VibixEmbed | null;
  /** Videoseed embed или null, если токен не задан. */
  videoseedUrl: string | null;
  /** Секунда, с которой реально стартует embed Videoseed (параметр start). */
  videoseedStart: number;
  /** Длительность контента в секундах (фильмы; для сериалов null). */
  durationSeconds: number | null;
  translations: Translation[];
  initialTranslationId: number | null;
  /** Тот же translation_id из прогресса, но БЕЗ фолбэка на первую озвучку
   *  Kodik (initialTranslationId выше — с ним, для нативного селектора
   *  Kodik-вкладки) — OwnPlayer.tsx должен знать, была ли озвучка РЕАЛЬНО
   *  сохранена, а не подставлена по умолчанию, иначе первый визит без
   *  прогресса мог бы случайно "восстановить" произвольную первую озвучку. */
  savedTranslationId: number | null;
  /** Озвучки для селектора «Наш плеер» (Videoseed + Kodik по kinopoisk_id) —
   *  отдельно от `translations` выше (те — только для нативного Kodik-плеера,
   *  без прямых embed-ссылок на КАЖДУЮ озвучку). См. §12 ARCHITECTURE.md. */
  ownPlayerTranslations: OwnPlayerTranslation[];
  /** Сохранённая с прошлого раза озвучка «Наш плеер» (по названию). */
  savedTranslationTitle: string | null;
  /** Стартовая позиция для восстановления (сек) или null. */
  resumeFrom: number | null;
  /** Сезон, на котором пользователь остановился в другом месте тайтла. */
  otherSeason: number | null;
  /** Серия, на которой пользователь остановился в другом месте тайтла. */
  otherEpisode: number | null;
  fallback: boolean;
  isAuthed: boolean;
}

const SAVE_INTERVAL_MS = 10_000;
const PLAYER_PREF_KEY = 'aw:cinemaPlayer';
/** Задержка автоперехода на следующую серию после окончания текущей. */
const AUTO_NEXT_DELAY_MS = 3_000;
/** Прогрев «Наш плеер» следующей серии — насколько раньше конца текущей
 *  (титры/аутро пользователь часто пропускает сам, не дожидаясь конца). */
const PREWARM_WINDOW_S = 300;
const PREWARM_POLL_MS = 15_000;

type PlayerKind = 'vibix' | 'videoseed' | 'kodik' | 'own';

/**
 * Событие плеера Vibix — ПЛОСКИЙ нативный формат Playerjs (выяснено
 * эмпирически по логу): {event: 'time'|'play'|..., time, data, duration}.
 * Обёртка {type:'playerEvent'} из их sync-библиотеки в реальности не приходит.
 */
interface VibixPlayerEvent {
  event?: string;
  time?: number;
  duration?: number;
  data?: unknown;
}

interface StepTarget {
  season: number;
  episode: number;
}

/** Ответ /api/watch/cinema/[id]/[season]/[episode] — см. switchEpisode. */
interface EpisodeSourcesResponse {
  kodikEmbedUrl: string;
  kodikTranslations: Translation[];
  kodikInitialTranslationId: number | null;
  kodikFallback: boolean;
  videoseedUrl: string | null;
  videoseedStart: number;
  ownPlayerTranslations: OwnPlayerTranslation[];
  resumeFrom: number | null;
}

/**
 * Считает соседнюю серию с переходом через границы сезонов.
 * dir = +1 (следующая) / -1 (предыдущая). null — если дальше некуда.
 */
function computeStep(
  seasonsList: SeasonInfo[],
  curSeason: number,
  curEpisode: number,
  dir: 1 | -1,
): StepTarget | null {
  const idx = seasonsList.findIndex((s) => s.season === curSeason);
  if (idx === -1) return null;
  const cur = seasonsList[idx];
  const nextEp = curEpisode + dir;
  if (nextEp >= 1 && nextEp <= cur.episodes) {
    return { season: curSeason, episode: nextEp };
  }
  if (dir === 1 && idx < seasonsList.length - 1) {
    return { season: seasonsList[idx + 1].season, episode: 1 };
  }
  if (dir === -1 && idx > 0) {
    const prev = seasonsList[idx - 1];
    return { season: prev.season, episode: prev.episodes };
  }
  return null;
}

export default function Player({
  shikimoriId,
  contentType,
  season,
  episode,
  seasons,
  total,
  animeTitle,
  posterUrl,
  initialEmbedUrl,
  vibixEmbed,
  videoseedUrl: initialVideoseedUrl,
  videoseedStart: initialVideoseedStart,
  durationSeconds,
  translations: initialTranslations,
  initialTranslationId,
  savedTranslationId,
  ownPlayerTranslations: initialOwnPlayerTranslations,
  savedTranslationTitle,
  resumeFrom: initialResumeFrom,
  otherSeason,
  otherEpisode,
  fallback: initialFallback,
  isAuthed,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const pipHost = usePipPlayerHost();

  // Раздел кино живёт под /cinema, аниме — под /anime и /watch.
  const isCinema = contentType === 'cinema';
  const detailHref = `${isCinema ? '/cinema' : '/anime'}/${shikimoriId}`;
  const watchBase = isCinema ? '/cinema/watch' : '/watch';
  const isSerial = seasons.length > 0;

  // Список сезонов: если детализации нет — один сезон с `total` серий.
  const seasonsList: SeasonInfo[] = useMemo(
    () => (seasons.length > 0 ? seasons : [{ season, episodes: total }]),
    [seasons, season, total],
  );
  const multiSeason = seasonsList.length > 1;

  // Источники серии — локальное состояние поверх начальных пропов: при
  // бесшовном переключении (см. switchEpisode) обновляются из ответа
  // /api/watch/cinema/..., а не через полную навигацию/перерендер страницы.
  const [embedUrl, setEmbedUrl] = useState(initialEmbedUrl);
  const [translationId, setTranslationId] = useState<number | null>(
    initialTranslationId,
  );
  const [translations, setTranslations] = useState(initialTranslations);
  const [videoseedUrl, setVideoseedUrl] = useState(initialVideoseedUrl);
  const [videoseedStart, setVideoseedStart] = useState(initialVideoseedStart);
  const [ownPlayerTranslations, setOwnPlayerTranslations] = useState(
    initialOwnPlayerTranslations,
  );
  const [fallback, setFallback] = useState(initialFallback);
  const [resumeFrom, setResumeFrom] = useState(initialResumeFrom);
  // Переключение серии в процессе — маленький индикатор поверх видео, а не
  // замена всей страницы (см. switchEpisode).
  const [switchingEpisode, setSwitchingEpisode] = useState(false);

  // Плееры по приоритету: Наш плеер (свой проксирующий стрим, без стороннего
  // iframe/рекламы) → Vibix (точный трекинг позиции) → Videoseed → Kodik.
  // Vibix/Videoseed доступны при наличии токенов и тайтла в их каталогах.
  const hasVibix = vibixEmbed !== null;
  const hasVideoseed = videoseedUrl !== null;
  const hasOwnPlayer = ownPlayerTranslations.length > 0;
  const [player, setPlayer] = useState<PlayerKind>(
    hasOwnPlayer ? 'own' : hasVibix ? 'vibix' : hasVideoseed ? 'videoseed' : 'kodik',
  );

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  // Автопереход на следующую серию: цель и таймер (null — отменён/неактивен).
  const [autoNext, setAutoNext] = useState<StepTarget | null>(null);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showOtherBanner, setShowOtherBanner] = useState(
    otherEpisode !== null,
  );
  // Активные сезон/серия: серия может измениться из самого плеера Kodik.
  const [activeSeason, setActiveSeason] = useState(season);
  const [activeEpisode, setActiveEpisode] = useState(episode);

  const currentSeasonEpisodes =
    seasonsList.find((s) => s.season === activeSeason)?.episodes ?? total;
  const showEpisode = currentSeasonEpisodes > 1 || multiSeason;

  // Позиция/длительность держим в ref, чтобы не триггерить ререндеры.
  const currentTimeRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  // iframe Videoseed — нужен оценщику позиции (клики, fullscreen).
  const vsIframeRef = useRef<HTMLIFrameElement>(null);
  // Контейнер, в который PipPlayerHost порталит реальный OwnPlayer (см.
  // эффект show/hide ниже и components/pip/PipPlayerHost.tsx).
  const ownPlayerDockRef = useRef<HTMLDivElement | null>(null);
  // Ожидающее восстановление позиции в Vibix (команда seek после готовности).
  const vibixSeekRef = useRef<number | null>(resumeFrom);
  const translationRef = useRef<number | null>(initialTranslationId);
  translationRef.current = translationId;
  const activeSeasonRef = useRef(activeSeason);
  activeSeasonRef.current = activeSeason;
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;
  // Держим playing в ref, чтобы realtime-подписка не пересоздавалась.
  const playingRef = useRef(false);
  playingRef.current = playing;
  // Прогрели ли уже следующую серию «Наш плеер» — сброс на каждую новую
  // активную серию (см. switchEpisode и эффект прогрева ниже).
  const prewarmedRef = useRef(false);

  // Синхронизируем активные сезон/серию при смене маршрута.
  useEffect(() => {
    setActiveSeason(season);
  }, [season]);
  useEffect(() => {
    setActiveEpisode(episode);
  }, [episode]);

  // Актуализируем ожидающий seek Vibix при обновлении resumeFrom (полная
  // навигация ИЛИ бесшовное переключение — см. switchEpisode).
  useEffect(() => {
    vibixSeekRef.current = resumeFrom;
  }, [resumeFrom]);

  // При навигации по маршруту сервер отдаёт новый embed — обновляем iframe.
  useEffect(() => {
    setEmbedUrl(initialEmbedUrl);
  }, [initialEmbedUrl]);

  // Применяем сохранённое предпочтение плеера после монтирования (чтобы не
  // ловить рассинхрон гидрации). Только если выбранный плеер доступен здесь.
  useEffect(() => {
    const pref = window.localStorage.getItem(PLAYER_PREF_KEY);
    if (
      pref === 'kodik' ||
      (pref === 'videoseed' && hasVideoseed) ||
      (pref === 'vibix' && hasVibix) ||
      (pref === 'own' && hasOwnPlayer)
    ) {
      setPlayer(pref);
    }
  }, [hasVideoseed, hasVibix, hasOwnPlayer]);

  // Переключение плеера с сохранением выбора.
  const switchPlayer = useCallback((next: PlayerKind) => {
    setPlayer(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PLAYER_PREF_KEY, next);
    }
  }, []);

  const next = computeStep(seasonsList, activeSeason, activeEpisode, 1);
  const prev = computeStep(seasonsList, activeSeason, activeEpisode, -1);
  const hasNext = next !== null;
  const hasPrev = prev !== null;

  const linkFor = (t: StepTarget) =>
    `${watchBase}/${shikimoriId}/${t.season}/${t.episode}`;

  // --- Диагностика: логируем ВСЕ postMessage от плеера -------------------
  // Включается флагом localStorage 'aw:debugPlayer' = '1'. Нужен, чтобы понять,
  // шлёт ли Videoseed события воспроизведения (play/time/started) и в каком
  // формате. Открыть фильм/серию → смотреть консоль.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem('aw:debugPlayer') !== '1') return;
    const log = (e: MessageEvent) => {
      // eslint-disable-next-line no-console
      console.log('[player msg]', e.origin, e.data);
    };
    window.addEventListener('message', log);
    // eslint-disable-next-line no-console
    console.log('[player msg] диагностика включена — играйте видео');
    return () => window.removeEventListener('message', log);
  }, []);

  // --- Отметка открытой серии (сезон/серия) ------------------------------
  // Videoseed (основной плеер) не сообщает странице позицию, поэтому для
  // сериалов фиксируем хотя бы «на какой серии остановился». Точная секунда
  // пишется отдельно, когда работает Kodik (он шлёт события времени).
  // Завязано на activeSeason/activeEpisode (а не на пропы season/episode) —
  // при бесшовном переключении (см. switchEpisode) пропы не меняются.
  useEffect(() => {
    if (!isAuthed || seasons.length === 0) return;
    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_type: contentType,
        shikimori_id: shikimoriId,
        anime_title: animeTitle,
        poster_url: posterUrl,
        season: activeSeason,
        episode: activeEpisode,
        mark: true,
      }),
      keepalive: true,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, shikimoriId, activeSeason, activeEpisode]);

  // --- Сохранение прогресса ---------------------------------------------
  const saveProgress = useCallback(
    (useBeacon = false) => {
      if (!isAuthed) return;
      const position = currentTimeRef.current;
      if (position < 5) return; // случайное открытие

      const payload = {
        content_type: contentType,
        shikimori_id: shikimoriId,
        anime_title: animeTitle,
        poster_url: posterUrl,
        season: activeSeasonRef.current,
        episode: activeEpisodeRef.current,
        position_seconds: position,
        duration_seconds: durationRef.current,
        translation_id: translationRef.current,
      };

      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify(payload)], {
          type: 'application/json',
        });
        navigator.sendBeacon('/api/progress', blob);
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
    [isAuthed, contentType, shikimoriId, animeTitle, posterUrl],
  );

  // --- Оценка позиции на Videoseed (плеер не отдаёт события) -------------
  // Пишет оценку в currentTimeRef и управляет `playing`, так что весь
  // существующий конвейер сохранения (heartbeat, флаши) работает как с Kodik.
  useVideoseedEstimator({
    enabled: player === 'videoseed' && hasVideoseed && isCinema,
    iframeRef: vsIframeRef,
    anchor: videoseedStart,
    durationSeconds,
    srcKey: videoseedUrl,
    onPlayingChange: (next) => {
      setPlaying(next);
      if (!next) saveProgress();
    },
    onTick: (pos) => {
      currentTimeRef.current = pos;
      if (durationSeconds && durationRef.current == null) {
        durationRef.current = durationSeconds;
      }
    },
  });

  // --- Переход к следующей серии по окончании ----------------------------
  const onEpisodeEnded = useCallback(() => {
    setEnded(true);
    setPlaying(false);
    const finishedSeason = activeSeasonRef.current;
    const finishedEpisode = activeEpisodeRef.current;
    const step = computeStep(seasonsList, finishedSeason, finishedEpisode, 1);

    if (isAuthed) {
      // Серия досмотрена — для подсветки в сетке; если это была последняя,
      // тайтл целиком уходит в «Просмотрено».
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: animeTitle,
          poster_url: posterUrl,
          season: finishedSeason,
          episode: finishedEpisode,
          watched_episode: true,
          completed: step === null,
        }),
        keepalive: true,
      }).catch(() => {});
    }

    if (isAuthed && step) {
      // Автопометка следующей серии как начатой (позиция > порога).
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: animeTitle,
          poster_url: posterUrl,
          season: step.season,
          episode: step.episode,
          position_seconds: 5, // > 5, чтобы запись прошла порог
          duration_seconds: null,
          translation_id: translationRef.current,
        }),
        keepalive: true,
      }).catch(() => {});
    }

    // Автопереход на следующую серию (с возможностью отмены в плашке).
    if (step) {
      setAutoNext(step);
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = setTimeout(() => {
        switchEpisodeRef.current(step);
      }, AUTO_NEXT_DELAY_MS);
    }
  }, [
    isAuthed,
    seasonsList,
    contentType,
    shikimoriId,
    animeTitle,
    posterUrl,
  ]);

  // Отмена автоперехода (кнопка в плашке).
  const cancelAutoNext = useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNext(null);
  }, []);

  // Сброс автоперехода при смене серии/размонтировании.
  useEffect(() => {
    setAutoNext(null);
    setEnded(false);
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    };
  }, [season, episode]);

  // --- Подписка на события Kodik через postMessage -----------------------
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as KodikMessage | undefined;
      if (typeof data !== 'object' || !data?.key) return;

      // Смена серии внутри плеера Kodik — чтобы прогресс писался под новой серией.
      if (
        data.key === KODIK_EVENTS.CURRENT_EPISODE ||
        data.key === KODIK_EVENTS.VIDEO_STARTED
      ) {
        const ep = parseEpisode(data.value);
        if (ep != null && ep >= 1 && ep !== activeEpisodeRef.current) {
          currentTimeRef.current = 0;
          durationRef.current = null;
          activeEpisodeRef.current = ep;
          setActiveEpisode(ep);
          setEnded(false);
        }
      }

      switch (data.key) {
        case KODIK_EVENTS.TIME_UPDATE:
          if (typeof data.value === 'number') {
            currentTimeRef.current = data.value;
          }
          break;
        case KODIK_EVENTS.DURATION_UPDATE:
          if (typeof data.value === 'number') {
            durationRef.current = data.value;
          }
          break;
        case KODIK_EVENTS.VIDEO_STARTED:
        case KODIK_EVENTS.PLAY:
          setPlaying(true);
          setEnded(false);
          break;
        case KODIK_EVENTS.PAUSE:
          setPlaying(false);
          saveProgress();
          break;
        case KODIK_EVENTS.VIDEO_ENDED:
          onEpisodeEnded();
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [saveProgress, onEpisodeEnded]);

  // --- Подписка на события Vibix ------------------------------------------
  // Плеер шлёт точное время ~4 раза/сек и события воспроизведения; принимает
  // команды. Сообщения Kodik имеют поле `key`, а не `event` — коллизий нет.
  useEffect(() => {
    if (player !== 'vibix') return;
    const handler = (e: MessageEvent) => {
      const data = e.data as VibixPlayerEvent | undefined;
      if (typeof data !== 'object' || data === null) return;
      if (typeof data.event !== 'string') return;

      if (typeof data.time === 'number' && Number.isFinite(data.time)) {
        currentTimeRef.current = data.time;
      }
      if (typeof data.duration === 'number' && data.duration > 0) {
        durationRef.current = data.duration;
      }

      // Восстановление позиции из БД. Шлём на started/play — ПОСЛЕ того, как
      // плеер применил свой локальный резюм (его внутренний seek идёт до
      // 'started'), иначе он перебил бы нашу позицию своей.
      const isStartEvent =
        data.event === 'started' ||
        data.event === 'start' ||
        data.event === 'play' ||
        data.event === 'userplay';
      if (
        vibixSeekRef.current !== null &&
        vibixSeekRef.current > 5 &&
        isStartEvent &&
        e.source
      ) {
        const target = Math.floor(vibixSeekRef.current);
        vibixSeekRef.current = null;
        const w = e.source as Window;
        // Нативная команда Playerjs; вторая — формат их sync-моста (запасной).
        w.postMessage({ api: 'seek', set: target }, '*');
        w.postMessage(
          {
            type: 'playerCommand',
            command: 'seek',
            value: target,
            timestamp: Date.now(),
          },
          '*',
        );
      }

      switch (data.event) {
        case 'play':
        case 'userplay':
        case 'resumed':
        case 'start':
        case 'started':
          setPlaying(true);
          setEnded(false);
          break;
        case 'pause':
        case 'userpause':
        case 'paused':
        case 'stop':
          setPlaying(false);
          saveProgress();
          break;
        case 'end':
        case 'finish':
          onEpisodeEnded();
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [player, saveProgress, onEpisodeEnded]);

  // --- Интервальное сохранение во время воспроизведения ------------------
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => saveProgress(), SAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, saveProgress]);

  // --- Флаш при уходе со страницы / скрытии вкладки ----------------------
  useEffect(() => {
    const onBeforeUnload = () => saveProgress(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveProgress(true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      // Флаш при размонтировании (навигация внутри SPA).
      saveProgress(true);
    };
  }, [saveProgress]);

  // --- Тост о восстановленной позиции ------------------------------------
  useEffect(() => {
    if (resumeFrom && resumeFrom > 5) {
      toast(`Вы остановились на ${formatTime(resumeFrom)}`, 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Realtime: синхронизация между устройствами (last-write-wins) -------
  // Подписка держится СТАБИЛЬНОЙ через бесшовные переключения серии (не в
  // deps ниже) — сравнение идёт по свежим activeSeasonRef/activeEpisodeRef,
  // а не по пропам season/episode (которые не меняются при switchEpisode).
  useEffect(() => {
    if (!isAuthed) return;
    const supabase = createClient();

    // Канал создаём синхронно и с уникальным именем — иначе в dev (Strict Mode
    // двойной монтаж) .on() может попасть на уже подписанный канал.
    // Фильтр по user_id не нужен: RLS отдаёт по Realtime только свои строки.
    const channel = supabase
      .channel(`wp-${shikimoriId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'watch_progress',
        },
        (payload) => {
          const row = payload.new as WatchProgress | undefined;
          if (!row || row.shikimori_id !== shikimoriId) return;
          // Реагируем только когда вкладка не активна/на паузе, чтобы не
          // перебивать активный просмотр. Другое место → предложить переход.
          const isBackground =
            document.visibilityState === 'hidden' || !playingRef.current;
          const elsewhere =
            row.episode !== activeEpisodeRef.current ||
            (row.season ?? 1) !== activeSeasonRef.current;
          if (isBackground && elsewhere) {
            const where = multiSeason
              ? `сезон ${row.season ?? 1}, серию ${row.episode}`
              : `серию ${row.episode}`;
            toast(`На другом устройстве вы перешли на ${where}`, 'info');
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthed, shikimoriId, multiSeason, toast]);

  // --- Бесшовное переключение серии ---------------------------------------
  // Вместо полной Next-навигации: флашим прогресс старой серии, оптимистично
  // обновляем текст/номер серии, тянем ТОЛЬКО нужные для новой серии
  // источники с /api/watch/cinema/... (без тайтл-уровневых данных — постер/
  // сезоны/похожее и т.п. не перезапрашиваются), обновляем адресную строку
  // через history.pushState (без полного роутинга Next). При сбое —
  // настоящая навигация как раньше, чтобы пользователь не застрял.
  const switchEpisode = useCallback(
    async (target: StepTarget, pushHistory = true) => {
      saveProgress(true);

      setSwitchingEpisode(true);
      setShowOtherBanner(false);
      setEnded(false);
      setAutoNext(null);
      if (autoNextTimerRef.current) {
        clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = null;
      }
      setActiveSeason(target.season);
      setActiveEpisode(target.episode);
      currentTimeRef.current = 0;
      durationRef.current = null;
      vibixSeekRef.current = null;
      prewarmedRef.current = false;

      try {
        const params = new URLSearchParams({ isSerial: isSerial ? '1' : '0' });
        if (translationRef.current != null) {
          params.set('translationId', String(translationRef.current));
        }
        const res = await fetch(
          `/api/watch/cinema/${shikimoriId}/${target.season}/${target.episode}?${params.toString()}`,
        );
        if (!res.ok) throw new Error('bad response');
        const data = (await res.json()) as EpisodeSourcesResponse;

        setEmbedUrl(data.kodikEmbedUrl);
        setTranslations(data.kodikTranslations);
        setTranslationId(data.kodikInitialTranslationId);
        setFallback(data.kodikFallback);
        setVideoseedUrl(data.videoseedUrl);
        setVideoseedStart(data.videoseedStart);
        setOwnPlayerTranslations(data.ownPlayerTranslations);
        setResumeFrom(data.resumeFrom);
        vibixSeekRef.current = data.resumeFrom;

        if (pushHistory) {
          window.history.pushState(null, '', linkForTarget(watchBase, shikimoriId, target));
        }
        document.title = `${animeTitle} — MediaWatch`;
      } catch {
        toast('Не удалось переключить серию, открываю страницу заново', 'error');
        router.push(linkForTarget(watchBase, shikimoriId, target));
      } finally {
        setSwitchingEpisode(false);
      }
    },
    [saveProgress, isSerial, shikimoriId, watchBase, animeTitle, toast, router],
  );
  // Всегда-свежая ссылка на switchEpisode — для замыканий, живущих дольше её
  // собственной идентичности (автопереход в onEpisodeEnded, объявленный выше).
  const switchEpisodeRef = useRef(switchEpisode);
  switchEpisodeRef.current = switchEpisode;

  // Кнопка «Назад»/«Вперёд» браузера — история двигалась через pushState в
  // switchEpisode, без участия роутера Next, поэтому ловим её сами.
  useEffect(() => {
    const titleBase = `${watchBase}/${shikimoriId}/`;
    const onPopState = () => {
      const path = window.location.pathname;
      if (!path.startsWith(titleBase)) return; // ушли с этого тайтла вовсе
      const parts = path.split('/').filter(Boolean);
      const s = Number(parts[parts.length - 2]);
      const e = Number(parts[parts.length - 1]);
      if (
        Number.isFinite(s) &&
        Number.isFinite(e) &&
        (s !== activeSeasonRef.current || e !== activeEpisodeRef.current)
      ) {
        switchEpisode({ season: s, episode: e }, false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [switchEpisode, watchBase, shikimoriId]);

  // --- Прогрев «Наш плеер» следующей серии --------------------------------
  // За 5 минут до конца текущей (не позже — титры/аутро часто пропускают
  // сами, не дожидаясь конца, см. обсуждение). Два шага: сперва лёгкий
  // /api/watch/cinema/... за списком озвучек следующей серии (обычный fetch
  // каталога, дёшево), затем HEAD на /api/proxy/.../{source}?t=<id> для
  // ПЕРВОЙ из них — тот самый роут, что реально вызывает resolveStream() и
  // кладёт результат в кэш (resolved_streams); первый шаг сам по себе ничего
  // не прогревает, только даёт знать, какой source/id пробовать. Если ссылка
  // успеет протухнуть у апстрима раньше реального переключения — есть штатный
  // forceFresh-фоллбэк в /api/proxy, прогрев в этом случае просто не даст
  // выигрыша, не ломает ничего.
  useEffect(() => {
    if (player !== 'own' || !hasOwnPlayer) return;
    const id = setInterval(() => {
      if (prewarmedRef.current) return;
      const dur = durationRef.current;
      if (!dur || dur - currentTimeRef.current > PREWARM_WINDOW_S) return;
      const step = computeStep(
        seasonsList,
        activeSeasonRef.current,
        activeEpisodeRef.current,
        1,
      );
      if (!step) return;
      prewarmedRef.current = true;
      const params = new URLSearchParams({ isSerial: isSerial ? '1' : '0' });
      if (translationRef.current != null) {
        params.set('translationId', String(translationRef.current));
      }
      fetch(
        `/api/watch/cinema/${shikimoriId}/${step.season}/${step.episode}?${params.toString()}`,
      )
        .then((r) => (r.ok ? (r.json() as Promise<EpisodeSourcesResponse>) : null))
        .then((data) => {
          const t = data?.ownPlayerTranslations[0];
          if (!t?.source) return;
          return fetch(
            `/api/proxy/cinema/${shikimoriId}/${step.season}/${step.episode}/${t.source}?t=${t.id}`,
            { method: 'HEAD' },
          );
        })
        .catch(() => {});
    }, PREWARM_POLL_MS);
    return () => clearInterval(id);
  }, [player, hasOwnPlayer, seasonsList, shikimoriId, isSerial]);

  // --- Держим OwnPlayer в PipPlayerHost в курсе актуальных пропсов -------
  // Реальный <video>/hls.js живёт не здесь (см. PipPlayerHost) — чтобы
  // пережить уход со страницы при активном Picture-in-Picture. Пока вкладка
  // «Наш плеер» открыта на этой странице — просим держатель рисовать его в
  // наш dock со свежими пропсами на каждом рендере (без списка зависимостей:
  // как обычный проброс пропсов, только через один хоп).
  const ownPlayerTitleKey = `${contentType}:${shikimoriId}`;
  useEffect(() => {
    if (player !== 'own' || !hasOwnPlayer || !ownPlayerDockRef.current) {
      pipHost.hide(ownPlayerTitleKey);
      return;
    }
    // eslint-disable-next-line no-console
    console.log('[pip-debug] Player.tsx show() call, resumeFrom=', resumeFrom);
    pipHost.show(
      ownPlayerTitleKey,
      {
        contentType,
        shikimoriId,
        season: activeSeason,
        episode: activeEpisode,
        extractSource: 'videoseed',
        animeTitle,
        posterUrl,
        isAuthed,
        resumeFrom,
        translations: ownPlayerTranslations,
        initialTranslationTitle: savedTranslationTitle,
        savedTranslationId,
        nextHref: next ? linkFor(next) : null,
        nextLabel: next && next.season !== activeSeason ? `Сезон ${next.season}` : undefined,
        onNext: next ? () => switchEpisode(next) : undefined,
        onEnded: onEpisodeEnded,
        onTimeUpdate: (t, d) => {
          // Держим общий конвейер прогресса в курсе (перенос позиции при
          // смене плеера, флаши при уходе со страницы, прогрев следующей
          // серии — см. эффект прогрева выше).
          currentTimeRef.current = t;
          if (d) durationRef.current = d;
        },
      },
      ownPlayerDockRef.current,
    );
  });

  // Настоящее размонтирование страницы (не путать с обычным ре-рендером
  // выше) — если PiP не активен, PipPlayerHost закроет сессию; если активен,
  // оставит <video> жить в своём скрытом контейнере (см. PipPlayerHost.hide).
  useEffect(() => {
    return () => pipHost.hide(ownPlayerTitleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Смена озвучки -----------------------------------------------------
  async function changeTranslation(nextId: number) {
    if (nextId === translationId) return;
    try {
      const params = new URLSearchParams({
        [isCinema ? 'kinopoiskId' : 'shikimoriId']: String(shikimoriId),
        season: String(activeSeasonRef.current),
        episode: String(activeEpisodeRef.current),
        translationId: String(nextId),
        startFrom: String(Math.floor(currentTimeRef.current)),
      });
      const res = await fetch(`/api/kodik?${params.toString()}`);
      if (!res.ok) throw new Error('Не удалось сменить озвучку');
      const data = (await res.json()) as { embedUrl: string };
      setTranslationId(nextId);
      setEmbedUrl(data.embedUrl);
      saveProgress();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      toast(msg, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={detailHref}
            className="line-clamp-1 text-lg font-bold hover:text-accent"
          >
            {animeTitle}
          </Link>
          {showEpisode && (
            <p className="text-sm text-gray-400">
              {multiSeason && `Сезон ${activeSeason} · `}
              Серия {activeEpisode} из {currentSeasonEpisodes}
            </p>
          )}
        </div>
      </div>

      {/* Баннер про другое место просмотра */}
      {showOtherBanner && otherEpisode !== null && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/20 bg-accent/10 px-4 py-3 text-sm">
          <span>
            Вы остановились на{' '}
            {multiSeason && otherSeason !== null
              ? `сезоне ${otherSeason}, серии ${otherEpisode}`
              : `серии ${otherEpisode}`}
            .
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                switchEpisode({ season: otherSeason ?? 1, episode: otherEpisode })
              }
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover"
            >
              Перейти
            </button>
            <button
              type="button"
              onClick={() => setShowOtherBanner(false)}
              className="text-gray-400 hover:text-white"
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Переключатель плеера — когда есть альтернативы Kodik */}
      {(hasVibix || hasVideoseed || hasOwnPlayer) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-gray-400">Плеер:</span>
          {/* overflow-x-auto + whitespace-nowrap — на узких экранах 4 вкладки
              (Vibix/Videoseed/Kodik/Наш плеер) не влезают в строку без этого:
              «Наш плеер» переносился на два ряда внутри своей же пилюли. */}
          <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-bg-card p-0.5 ring-1 ring-white/5">
            {(
              [
                hasVibix ? (['vibix', 'Vibix'] as const) : null,
                hasVideoseed ? (['videoseed', 'Videoseed'] as const) : null,
                ['kodik', 'Kodik'] as const,
                hasOwnPlayer ? (['own', 'Наш плеер'] as const) : null,
              ].filter(Boolean) as ReadonlyArray<readonly [PlayerKind, string]>
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                onClick={() => switchPlayer(kind)}
                className={[
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition',
                  player === kind
                    ? 'bg-accent text-white'
                    : 'text-gray-300 hover:text-white',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          {switchingEpisode && (
            <span className="text-xs text-gray-400">переключаем…</span>
          )}
        </div>
      )}

      {/* Плеер 16:9 */}
      {player === 'own' && hasOwnPlayer ? (
        // Свой плеер рисует контейнер сам, но не здесь напрямую — реальный
        // OwnPlayer живёт в PipPlayerHost (см. app/layout.tsx), сюда он
        // приезжает порталом (см. эффект show/hide ниже). Так Picture-in-
        // Picture переживает уход с этой страницы: PipPlayerHost не даёт
        // <video> покинуть документ, пока плавающее окно открыто.
        <div ref={ownPlayerDockRef} />
      ) : (
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        {player === 'vibix' && vibixEmbed ? (
          <VibixPlayer
            key={`vibix-${vibixEmbed.id}-${activeSeason}-${activeEpisode}`}
            embed={vibixEmbed}
            season={activeSeason}
            episode={activeEpisode}
            isSerial={seasons.length > 0}
          />
        ) : player === 'videoseed' && videoseedUrl ? (
          <iframe
            ref={vsIframeRef}
            key={`vs-${videoseedUrl}`}
            src={videoseedUrl}
            title={`${animeTitle} — серия ${activeEpisode}`}
            allowFullScreen
            allow="autoplay *; fullscreen *"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : fallback ? (
          // Kodik не нашёл этот тайтл (или не настроен) — не встраиваем
          // битый iframe. Формулировка зависит от того, есть ли ещё
          // источники в переключателе выше: если да, предлагаем их
          // попробовать, иначе — нейтральное "недоступно" без деталей о
          // серверной конфигурации (KODIK_TOKEN и т.п. — это не забота
          // зрителя).
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-soft p-6 text-center">
            <div className="text-4xl">🎬</div>
            <p className="text-sm font-medium text-gray-200">
              Этот источник сейчас недоступен
            </p>
            <p className="max-w-md text-xs leading-relaxed text-gray-400">
              {hasVibix || hasVideoseed || hasOwnPlayer
                ? 'Попробуйте другой плеер в переключателе выше.'
                : 'Попробуйте зайти позже.'}
            </p>
          </div>
        ) : (
          <iframe
            key={`kodik-${embedUrl}`}
            src={embedUrl}
            title={`${animeTitle} — серия ${activeEpisode}`}
            allowFullScreen
            allow="autoplay *; fullscreen *"
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>
      )}

      {/* Панель управления */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {hasPrev && prev ? (
            <button
              type="button"
              onClick={() => switchEpisode(prev)}
              className="rounded-lg bg-bg-card px-4 py-2 text-sm font-medium text-gray-100 ring-1 ring-white/10 transition hover:bg-bg-soft"
            >
              ← Пред.
            </button>
          ) : (
            <span
              aria-disabled="true"
              className="rounded-lg bg-bg-card/50 px-4 py-2 text-sm font-medium text-gray-400 ring-1 ring-white/10"
            >
              ← Пред.
            </span>
          )}
          {hasNext && next ? (
            <button
              type="button"
              onClick={() => switchEpisode(next)}
              className="rounded-lg bg-bg-card px-4 py-2 text-sm font-medium text-gray-100 ring-1 ring-white/10 transition hover:bg-bg-soft"
            >
              След. →
            </button>
          ) : (
            <span
              aria-disabled="true"
              className="rounded-lg bg-bg-card/50 px-4 py-2 text-sm font-medium text-gray-400 ring-1 ring-white/10"
            >
              След. →
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Выбор сезона (для многосезонных сериалов) */}
          {multiSeason && (
            <label className="flex items-center gap-2 text-sm text-gray-400">
              Сезон:
              <select
                value={activeSeason}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  switchEpisode({ season: s, episode: 1 });
                }}
                className="rounded-lg border border-white/10 bg-bg-card px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none"
              >
                {seasonsList.map((s) => (
                  <option key={s.season} value={s.season}>
                    {s.season}
                  </option>
                ))}
              </select>
            </label>
          )}

          {player === 'kodik' && translations.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-400">
              Озвучка:
              <select
                value={translationId ?? ''}
                onChange={(e) => changeTranslation(Number(e.target.value))}
                className="rounded-lg border border-white/10 bg-bg-card px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none"
              >
                {translations.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Плашка окончания серии */}
      {ended && hasNext && next && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-card px-4 py-3 text-sm">
          <span>
            Серия {activeEpisode} просмотрена.
            {autoNext && (
              <span className="text-gray-400">
                {' '}
                Следующая включится через пару секунд…
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {autoNext && (
              <button
                type="button"
                onClick={cancelAutoNext}
                className="rounded-md px-3 py-1.5 font-medium text-gray-300 ring-1 ring-white/10 hover:text-white"
              >
                Отмена
              </button>
            )}
            <button
              type="button"
              onClick={() => switchEpisode(next)}
              className="rounded-md bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-hover"
            >
              {next.season !== activeSeason
                ? `Сезон ${next.season} →`
                : 'Следующая серия →'}
            </button>
          </div>
        </div>
      )}

      {!isAuthed && (
        <p className="rounded-lg border border-white/5 bg-bg-card px-4 py-3 text-sm text-gray-400">
          Вы смотрите как гость — прогресс не сохраняется.{' '}
          <Link href="/login" className="text-accent hover:underline">
            Войдите
          </Link>
          , чтобы синхронизировать позицию между устройствами.
        </p>
      )}
    </div>
  );
}

function linkForTarget(watchBase: string, shikimoriId: number, t: StepTarget): string {
  return `${watchBase}/${shikimoriId}/${t.season}/${t.episode}`;
}

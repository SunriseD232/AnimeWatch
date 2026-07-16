'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import {
  KODIK_EVENTS,
  parseEpisode,
  type KodikMessage,
} from '@/lib/video/kodik-events';
import type { Translation } from '@/lib/video/types';
import type { SeasonInfo } from '@/lib/videoseed-catalog';
import type { ContentType, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { useVideoseedEstimator } from '@/hooks/useVideoseedEstimator';

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
  /** Videoseed embed (основной плеер) или null, если токен не задан. */
  videoseedUrl: string | null;
  /** Секунда, с которой реально стартует embed Videoseed (параметр start). */
  videoseedStart: number;
  /** Длительность контента в секундах (фильмы; для сериалов null). */
  durationSeconds: number | null;
  translations: Translation[];
  initialTranslationId: number | null;
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

interface StepTarget {
  season: number;
  episode: number;
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
  videoseedUrl,
  videoseedStart,
  durationSeconds,
  translations,
  initialTranslationId,
  resumeFrom,
  otherSeason,
  otherEpisode,
  fallback,
  isAuthed,
}: Props) {
  const { toast } = useToast();

  // Раздел кино живёт под /cinema, аниме — под /anime и /watch.
  const isCinema = contentType === 'cinema';
  const detailHref = `${isCinema ? '/cinema' : '/anime'}/${shikimoriId}`;
  const watchBase = isCinema ? '/cinema/watch' : '/watch';

  // Список сезонов: если детализации нет — один сезон с `total` серий.
  const seasonsList: SeasonInfo[] = useMemo(
    () => (seasons.length > 0 ? seasons : [{ season, episodes: total }]),
    [seasons, season, total],
  );
  const multiSeason = seasonsList.length > 1;

  // Плеер: Videoseed (основной) ↔ Kodik (второстепенный). Переключатель
  // показываем только когда доступен Videoseed (задан токен).
  const hasVideoseed = videoseedUrl !== null;
  const [player, setPlayer] = useState<'videoseed' | 'kodik'>(
    hasVideoseed ? 'videoseed' : 'kodik',
  );

  const [embedUrl, setEmbedUrl] = useState(initialEmbedUrl);
  const [translationId, setTranslationId] = useState<number | null>(
    initialTranslationId,
  );
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
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
  const translationRef = useRef<number | null>(initialTranslationId);
  translationRef.current = translationId;
  const activeSeasonRef = useRef(activeSeason);
  activeSeasonRef.current = activeSeason;
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;
  // Держим playing в ref, чтобы realtime-подписка не пересоздавалась.
  const playingRef = useRef(false);
  playingRef.current = playing;

  // Синхронизируем активные сезон/серию при смене маршрута.
  useEffect(() => {
    setActiveSeason(season);
  }, [season]);
  useEffect(() => {
    setActiveEpisode(episode);
  }, [episode]);

  // При навигации по маршруту сервер отдаёт новый embed — обновляем iframe.
  useEffect(() => {
    setEmbedUrl(initialEmbedUrl);
  }, [initialEmbedUrl]);

  // Применяем сохранённое предпочтение плеера после монтирования (чтобы не
  // ловить рассинхрон гидрации). Только когда Videoseed доступен.
  useEffect(() => {
    if (!hasVideoseed) return;
    const pref = window.localStorage.getItem(PLAYER_PREF_KEY);
    if (pref === 'kodik' || pref === 'videoseed') setPlayer(pref);
  }, [hasVideoseed]);

  // Переключение плеера с сохранением выбора.
  const switchPlayer = useCallback((next: 'videoseed' | 'kodik') => {
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
        season,
        episode,
        mark: true,
      }),
      keepalive: true,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, shikimoriId, season, episode]);

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
    // Автопометка следующей серии как начатой (позиция > порога).
    const step = computeStep(
      seasonsList,
      activeSeasonRef.current,
      activeEpisodeRef.current,
      1,
    );
    if (isAuthed && step) {
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
  }, [
    isAuthed,
    seasonsList,
    contentType,
    shikimoriId,
    animeTitle,
    posterUrl,
  ]);

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
            row.episode !== episode || (row.season ?? 1) !== season;
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
  }, [isAuthed, shikimoriId, episode, season, multiSeason, toast]);

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
            <Link
              href={`${watchBase}/${shikimoriId}/${otherSeason ?? 1}/${otherEpisode}`}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover"
            >
              Перейти
            </Link>
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

      {/* Переключатель плеера — когда доступен основной (Videoseed) */}
      {hasVideoseed && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Плеер:</span>
          <div className="inline-flex rounded-lg bg-bg-card p-0.5 ring-1 ring-white/5">
            <button
              type="button"
              onClick={() => switchPlayer('videoseed')}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                player === 'videoseed'
                  ? 'bg-accent text-white'
                  : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              Videoseed
            </button>
            <button
              type="button"
              onClick={() => switchPlayer('kodik')}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                player === 'kodik'
                  ? 'bg-accent text-white'
                  : 'text-gray-300 hover:text-white',
              ].join(' ')}
            >
              Kodik
            </button>
          </div>
        </div>
      )}

      {/* Плеер 16:9 */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
        {player === 'videoseed' && videoseedUrl ? (
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
          // Режим B: рабочего token-free плеера нет — показываем заглушку
          // с инструкцией (как предусмотрено ТЗ), а не битый iframe.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-soft p-6 text-center">
            <div className="text-4xl">🎬</div>
            <p className="text-sm font-medium text-gray-200">
              Видео недоступно в демо-режиме
            </p>
            <p className="max-w-md text-xs leading-relaxed text-gray-400">
              Для воспроизведения нужен бесплатный{' '}
              <code className="rounded bg-black/30 px-1">KODIK_TOKEN</code>.
              Добавьте его в окружение — подключится реальный плеер Kodik с
              выбором озвучки и автоматическим трекингом позиции просмотра.
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

      {/* Панель управления */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={hasPrev && prev ? linkFor(prev) : '#'}
            aria-disabled={!hasPrev}
            className={[
              'rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
              hasPrev
                ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
                : 'pointer-events-none bg-bg-card/50 text-gray-600',
            ].join(' ')}
          >
            ← Пред.
          </Link>
          <Link
            href={hasNext && next ? linkFor(next) : '#'}
            aria-disabled={!hasNext}
            className={[
              'rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition',
              hasNext
                ? 'bg-bg-card text-gray-100 hover:bg-bg-soft'
                : 'pointer-events-none bg-bg-card/50 text-gray-600',
            ].join(' ')}
          >
            След. →
          </Link>
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
                  window.location.href = `${watchBase}/${shikimoriId}/${s}/1`;
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
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-card px-4 py-3 text-sm">
          <span>Серия {activeEpisode} просмотрена.</span>
          <Link
            href={linkFor(next)}
            className="rounded-md bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-hover"
          >
            {next.season !== activeSeason
              ? `Сезон ${next.season} →`
              : 'Следующая серия →'}
          </Link>
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

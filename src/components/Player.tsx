'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';
import {
  KODIK_EVENTS,
  parseEpisode,
  type KodikMessage,
} from '@/lib/video/kodik-events';
import type { Translation } from '@/lib/video/types';
import type { ContentType, WatchProgress } from '@/lib/types';
import { formatTime } from '@/lib/format';

interface Props {
  shikimoriId: number;
  /** Тип контента — от него зависят ссылки и запись прогресса. */
  contentType: ContentType;
  episode: number;
  total: number;
  animeTitle: string;
  posterUrl: string | null;
  initialEmbedUrl: string;
  translations: Translation[];
  initialTranslationId: number | null;
  /** Стартовая позиция для восстановления (сек) или null. */
  resumeFrom: number | null;
  /** Серия, на которой пользователь остановился в другом месте тайтла. */
  otherEpisode: number | null;
  fallback: boolean;
  isAuthed: boolean;
}

const SAVE_INTERVAL_MS = 10_000;

export default function Player({
  shikimoriId,
  contentType,
  episode,
  total,
  animeTitle,
  posterUrl,
  initialEmbedUrl,
  translations,
  initialTranslationId,
  resumeFrom,
  otherEpisode,
  fallback,
  isAuthed,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();

  // Раздел кино живёт под /cinema, аниме — под /anime и /watch.
  const isCinema = contentType === 'cinema';
  const detailHref = `${isCinema ? '/cinema' : '/anime'}/${shikimoriId}`;
  const watchBase = isCinema ? '/cinema/watch' : '/watch';
  const showEpisode = total > 1;

  const [embedUrl, setEmbedUrl] = useState(initialEmbedUrl);
  const [translationId, setTranslationId] = useState<number | null>(
    initialTranslationId,
  );
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [showOtherBanner, setShowOtherBanner] = useState(
    otherEpisode !== null,
  );
  // Активная серия: может измениться из самого плеера Kodik (внутренняя навигация).
  const [activeEpisode, setActiveEpisode] = useState(episode);

  // Позиция/длительность держим в ref, чтобы не триггерить ререндеры.
  const currentTimeRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const translationRef = useRef<number | null>(initialTranslationId);
  translationRef.current = translationId;
  const activeEpisodeRef = useRef(activeEpisode);
  activeEpisodeRef.current = activeEpisode;
  // Держим playing в ref, чтобы realtime-подписка не пересоздавалась.
  const playingRef = useRef(false);
  playingRef.current = playing;

  // Синхронизируем активную серию при смене маршрута (кнопки «След./Пред.»).
  useEffect(() => {
    setActiveEpisode(episode);
  }, [episode]);

  // При навигации по маршруту сервер отдаёт новый embed — обновляем iframe.
  useEffect(() => {
    setEmbedUrl(initialEmbedUrl);
  }, [initialEmbedUrl]);

  const hasNext = activeEpisode < total;
  const hasPrev = activeEpisode > 1;

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

  // --- Переход к следующей серии по окончании ----------------------------
  const onEpisodeEnded = useCallback(() => {
    setEnded(true);
    setPlaying(false);
    // Автопометка серии как просмотренной: прогресс на следующую, позиция 0.
    if (isAuthed && hasNext) {
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          shikimori_id: shikimoriId,
          anime_title: animeTitle,
          poster_url: posterUrl,
          episode: activeEpisodeRef.current + 1,
          position_seconds: 5, // > 5, чтобы запись прошла порог
          duration_seconds: null,
          translation_id: translationRef.current,
        }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [isAuthed, hasNext, contentType, shikimoriId, animeTitle, posterUrl]);

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
          // перебивать активный просмотр. Другая серия → предложить переход.
          const isBackground =
            document.visibilityState === 'hidden' || !playingRef.current;
          if (isBackground && row.episode !== episode) {
            toast(
              `На другом устройстве вы перешли на серию ${row.episode}`,
              'info',
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthed, shikimoriId, episode, toast]);

  // --- Смена озвучки -----------------------------------------------------
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
              Серия {activeEpisode} из {total}
            </p>
          )}
        </div>
      </div>

      {/* Баннер про другую серию */}
      {showOtherBanner && otherEpisode !== null && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/20 bg-accent/10 px-4 py-3 text-sm">
          <span>Вы остановились на серии {otherEpisode}.</span>
          <div className="flex items-center gap-2">
            <Link
              href={`${watchBase}/${shikimoriId}/${otherEpisode}`}
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

      {/* Плеер 16:9 */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
        {fallback ? (
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
            key={embedUrl}
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
            href={
              hasPrev ? `${watchBase}/${shikimoriId}/${activeEpisode - 1}` : '#'
            }
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
            href={
              hasNext ? `${watchBase}/${shikimoriId}/${activeEpisode + 1}` : '#'
            }
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

        {translations.length > 0 && (
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

      {/* Плашка окончания серии */}
      {ended && hasNext && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-bg-card px-4 py-3 text-sm">
          <span>Серия {activeEpisode} просмотрена.</span>
          <Link
            href={`${watchBase}/${shikimoriId}/${activeEpisode + 1}`}
            className="rounded-md bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-hover"
          >
            Следующая серия →
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

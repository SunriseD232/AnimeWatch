'use client';

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { ContentType } from '@/lib/types';

interface PlaybackState {
  position: number;
  duration: number | null;
  translationId: number | null;
  /** Текстовая метка озвучки (стабильна между сериями в отличие от
   *  translationId — см. миграцию 0008) — для восстановления выбора на
   *  следующем заходе. Как и translationId — плееры, которые её не знают,
   *  пишут null (upsert перезаписывает всю строку, не патчит поля). */
  translationTitle?: string | null;
  /**
   * Активная серия. Держим в состоянии плеера (а не в аргументах хука), чтобы
   * учитывать смену серии ВНУТРИ Kodik-плеера — иначе прогресс писался бы под
   * старым номером и серия «не засчитывалась».
   */
  episode: number;
  /** Сезон (кино/сериалы). Не задан — сервер считает 1. */
  season?: number;
}

interface Args {
  contentType: ContentType;
  shikimoriId: number;
  animeTitle: string;
  posterUrl: string | null;
  isAuthed: boolean;
  /** Возвращает текущее состояние воспроизведения (позиция/длительность/серия). */
  getState: () => PlaybackState;
  /** Флаг «идёт воспроизведение» — для интервального сохранения. */
  playingRef: MutableRefObject<boolean>;
}

// Клиентские переходы по Link (например, клик по логотипу в шапке) не ждут
// сохранения: Next.js сначала фетчит данные ЦЕЛЕВОЙ страницы и только потом
// размонтирует текущую — flush на unmount/beforeunload физически не
// успевает попасть в БД раньше, чем главная уже отрисовала «Продолжить
// просмотр» по старым данным (воспроизведено вживую: без ручного reload
// показывает позицию из последнего интервального сохранения). Полностью
// убрать эту гонку без глобального перехвата навигации нельзя — вместо
// этого просто сузили окно устаревания частым интервалом.
const SAVE_INTERVAL_MS = 5_000;
const MIN_POSITION = 5; // не сохраняем случайные открытия (< 5 сек)

// Доля серии, после которой считаем её досмотренной. Та же граница, что у
// nearEnd на сервере при восстановлении позиции (см.
// watch/[shikimoriId]/[episode]/page.tsx) и у ручного переключения серии в
// WatchPlayer/Player.
//
// ЗАЧЕМ ЭТО ЗДЕСЬ. До этого в watched_episodes писали только два места:
// событие 'ended' у <video> и switchEpisode при >90%. Оба легко не
// наступают: 'ended' не приходит, если человек досмотрел титры не до
// последнего кадра и закрыл вкладку, а порог в switchEpisode сравнивал
// длительность из durationRef, который заполнял ТОЛЬКО OwnPlayer (Kodik,
// AniLibria и Yummy отдавали наверх одну позицию без длительности) — то
// есть для трёх источников из четырёх этот путь был мёртвым. На проде
// 12.09.2026: 57969 серия 11 сохранена с позицией 1396 из 1428 (97.8%) и в
// историю не попала вовсе; у 62001 в истории нет серий 3, 5, 8 и 15, причём
// у 15-й позиция 1322 из 1420 (93%).
//
// Здесь же длительность есть у всех плееров без исключения (её и так
// пишут в watch_progress.duration_seconds), поэтому отметка уезжает тем же
// периодическим сохранением, что и позиция, и ни от какого события не
// зависит.
const WATCHED_RATIO = 0.9;

/**
 * Общая логика сохранения прогресса для любого плеера (HLS / Kodik).
 * Пишет каждые 10 сек во время воспроизведения, при уходе со страницы и
 * скрытии вкладки (через sendBeacon, чтобы флаш не терялся). Возвращает
 * функцию ручного сохранения (например, для события pause).
 */
export function useProgressSaver({
  contentType,
  shikimoriId,
  animeTitle,
  posterUrl,
  isAuthed,
  getState,
  playingRef,
}: Args) {
  // Держим getState в ref, чтобы save не пересоздавался каждый рендер.
  const getStateRef = useRef(getState);
  getStateRef.current = getState;

  // Какие серии уже отметили досмотренными в этой сессии плеера — чтобы не
  // повторять отметку каждые пять секунд на титрах. Ключ с сезоном: у
  // сериалов номера серий повторяются от сезона к сезону.
  const markedRef = useRef<Set<string>>(new Set());

  const save = useCallback(
    (useBeacon = false) => {
      if (!isAuthed) return;
      const { position, duration, translationId, translationTitle, episode, season } =
        getStateRef.current();
      if (!Number.isFinite(position) || position < MIN_POSITION) return;

      // Серия досмотрена — отмечаем ОДИН раз за серию, тем же запросом, что
      // несёт позицию: сервер обрабатывает и пометку, и позицию вместе.
      const episodeKey = `${season ?? 1}:${episode}`;
      const nearEnd =
        duration != null &&
        Number.isFinite(duration) &&
        duration > 0 &&
        position / duration > WATCHED_RATIO;
      const markWatched = nearEnd && !markedRef.current.has(episodeKey);
      if (markWatched) markedRef.current.add(episodeKey);

      const payload = {
        content_type: contentType,
        shikimori_id: shikimoriId,
        anime_title: animeTitle,
        poster_url: posterUrl,
        ...(season != null ? { season } : {}),
        episode,
        position_seconds: position,
        duration_seconds:
          duration != null && Number.isFinite(duration) ? duration : null,
        translation_id: translationId,
        translation_title: translationTitle ?? null,
        ...(markWatched ? { watched_episode: true } : {}),
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
    [isAuthed, contentType, shikimoriId, animeTitle, posterUrl],
  );

  // Интервальное сохранение во время воспроизведения.
  useEffect(() => {
    const id = setInterval(() => {
      if (playingRef.current) save();
    }, SAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [save, playingRef]);

  // Флаш при уходе со страницы / скрытии вкладки / размонтировании.
  // pagehide — вместе с beforeunload: часть браузеров не гарантируют
  // beforeunload (особенно на мобильных при сворачивании), pagehide надёжнее
  // ловит и полный уход, и переход в bfcache.
  useEffect(() => {
    const onBeforeUnload = () => save(true);
    const onPageHide = () => save(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save(true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      save(true);
    };
  }, [save]);

  return save;
}

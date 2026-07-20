'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgressSaver } from '@/hooks/useProgressSaver';
import { KODIK_EVENTS, type KodikMessage } from '@/lib/video/kodik-events';
import type { YummyTranslation } from '@/lib/video/yummy';

interface Props {
  shikimoriId: number;
  episode: number;
  animeTitle: string;
  posterUrl: string | null;
  isAuthed: boolean;
  translations: YummyTranslation[];
  /** Стартовая позиция для восстановления (сек) или null. Работает только
   *  для Kodik-эмбедов — их плеер поддерживает параметр start_from. */
  resumeFrom: number | null;
  onEnded?: () => void;
}

/**
 * Часть переводов Yummy — обычные embed'ы Kodik (`kodikplayer.com`), для
 * которых протокол postMessage уже известен и используется в KodikPlayer.tsx.
 * Для Alloha/Sibnet/Aksor протокола нет (проверено: в их JS-бандлах нет ни
 * одного упоминания postMessage/MessageEvent) — там точный трекинг невозможен.
 */
function isKodikEmbed(url: string): boolean {
  return url.includes('kodikplayer.com');
}

/**
 * Добавляет start_from к Kodik-эмбеду — их сервер сам подставляет позицию
 * при рендере страницы плеера (проверено вживую: разница в HTML при разных
 * значениях параметра, включая инлайновый parseStartfrom(...) в разметке —
 * это НЕ клиентский JS, поэтому его не видно в бандле плеера при статическом
 * анализе, но параметр реально работает).
 */
function withStartFrom(embedUrl: string, resumeFrom: number | null): string {
  if (!resumeFrom || resumeFrom < 5) return embedUrl;
  try {
    const url = new URL(
      embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl,
    );
    url.searchParams.set('start_from', String(Math.floor(resumeFrom)));
    return url.toString();
  } catch {
    return embedUrl;
  }
}

/**
 * Резервный плеер Yummy (iframe на Kodik/Alloha/Sibnet/Aksor — конкретный
 * балансер определяется выбранным вариантом озвучки). Когда выбранный
 * перевод оказывается Kodik-эмбедом — включаем точный трекинг позиции (те же
 * события, что и в KodikPlayer.tsx). Для остальных балансеров протокол
 * неизвестен — только отметка «открыл эту серию» без точной позиции.
 * Список переводов и их embed-адреса уже готовы (со стороны сервера),
 * поэтому смена озвучки — мгновенная, без запроса.
 */
export default function YummyPlayer({
  shikimoriId,
  episode,
  animeTitle,
  posterUrl,
  isAuthed,
  translations,
  resumeFrom,
  onEnded,
}: Props) {
  const [translationId, setTranslationId] = useState<number | null>(
    translations[0]?.id ?? null,
  );
  const active =
    translations.find((t) => t.id === translationId) ?? translations[0] ?? null;
  const trackable = active ? isKodikEmbed(active.embedUrl) : false;
  // Возобновление позиции — только для Kodik-эмбедов (см. withStartFrom) и
  // только при первом показе серии (ниже: сбрасывается при смене перевода
  // внутри той же серии, чтобы не мотать заново после ручного переключения).
  const [seedResume, setSeedResume] = useState(true);
  const embedUrl = active
    ? seedResume && trackable
      ? withStartFrom(active.embedUrl, resumeFrom)
      : active.embedUrl
    : null;

  const currentTimeRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const playingRef = useRef(false);

  const getState = useCallback(
    () => ({
      position: currentTimeRef.current,
      duration: durationRef.current,
      translationId: null,
      episode,
    }),
    [episode],
  );

  const save = useProgressSaver({
    contentType: 'anime',
    shikimoriId,
    animeTitle,
    posterUrl,
    isAuthed,
    getState,
    playingRef,
  });

  // Смена серии — сброс на первый вариант, обнуление трекинга (иначе позиция
  // от прошлой серии могла бы утечь в новую) и повторное разрешение
  // возобновления (resumeFrom теперь относится к новой серии).
  useEffect(() => {
    setTranslationId(translations[0]?.id ?? null);
    currentTimeRef.current = 0;
    durationRef.current = null;
    playingRef.current = false;
    setSeedResume(true);
  }, [translations]);

  // Ручная смена озвучки внутри той же серии — позицию из resumeFrom (она с
  // момента загрузки страницы) больше не подставляем: реальная позиция могла
  // уйти вперёд, а между нетрекаемыми источниками мы её не переносим.
  function changeTranslation(nextId: number) {
    setSeedResume(false);
    setTranslationId(nextId);
  }

  // Точный трекинг — только когда выбранный перевод оказался Kodik-эмбедом.
  useEffect(() => {
    if (!trackable) return;
    const handler = (e: MessageEvent) => {
      const data = e.data as KodikMessage | undefined;
      if (typeof data !== 'object' || !data?.key) return;
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
          playingRef.current = true;
          break;
        case KODIK_EVENTS.PAUSE:
          playingRef.current = false;
          save();
          break;
        case KODIK_EVENTS.VIDEO_ENDED:
          playingRef.current = false;
          save();
          onEnded?.();
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [trackable, save, onEnded]);

  // Отметка открытой серии — только для нетрекаемых источников (Alloha/
  // Sibnet/Aksor), без точной позиции. Для Kodik-эмбедов это не нужно:
  // реальные события сами наполнят прогресс, как только начнётся показ.
  useEffect(() => {
    if (!isAuthed || trackable) return;
    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_type: 'anime',
        shikimori_id: shikimoriId,
        anime_title: animeTitle,
        poster_url: posterUrl,
        season: 1,
        episode,
        mark: true,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [isAuthed, trackable, shikimoriId, episode, animeTitle, posterUrl]);

  if (!active || !embedUrl) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        <iframe
          key={embedUrl}
          src={embedUrl}
          title={`${animeTitle} — серия ${episode}`}
          allowFullScreen
          allow="autoplay *; fullscreen *"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-300">
          Источник: Yummy
        </span>
        {trackable && (
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
            Точная позиция
          </span>
        )}
        {translations.length > 1 && (
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

      {!trackable && (
        <p className="text-xs text-gray-500">
          Резервный источник: точная позиция просмотра не сохраняется.
        </p>
      )}
    </div>
  );
}

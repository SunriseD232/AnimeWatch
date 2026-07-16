'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Оценщик позиции просмотра для iframe Videoseed (Playerjs с выключенным
 * postMessage API). Плеер не сообщает странице ни время, ни play/pause,
 * поэтому позицию реконструируем по косвенным сигналам родительского окна.
 *
 * Модель — машина состояний «играет/пауза»:
 *  - Якорь: секунда, с которой iframe реально стартовал (параметр start).
 *  - Клик внутрь iframe ловим через window.blur + activeElement === iframe.
 *    Клик по центру плеера — тумблер play/pause; клик по нижней полосе
 *    (зона контролов) состояние не меняет (перемотку изнутри увидеть нельзя,
 *    поэтому позиция после неё остаётся приблизительной by design).
 *  - Когда курсор уходит с плеера, возвращаем фокус странице (el.blur()),
 *    чтобы поймать следующий клик тем же способом. Побочный эффект: горячие
 *    клавиши плеера работают только пока фокус в нём (до увода курсора).
 *  - Полноэкранный режим (fullscreenElement === iframe) ⇒ считаем «играет».
 *  - Пока «играет», копим время по Date.now()-дельтам (setInterval в фоновых
 *    вкладках троттлится, а видео в фоне продолжает играть).
 *  - Потолки: позиция ≤ 95% длительности; если накоплено > 120% длительности
 *    (или 6 часов, когда длительность неизвестна) — принудительная «пауза»,
 *    чтобы забытая вкладка не «досмотрела» фильм за пользователя.
 *
 * Точность: без перемоток — единицы секунд; с перемотками — приблизительно.
 * Когда Videoseed включит postMessage, этот хук заменяется точными событиями.
 */

interface EstimatorOptions {
  /** Активен только когда на экране iframe Videoseed. */
  enabled: boolean;
  iframeRef: RefObject<HTMLIFrameElement>;
  /** Секунда, с которой стартовал embed (значение параметра start). */
  anchor: number;
  /** Длительность контента в секундах, если известна (для потолков). */
  durationSeconds: number | null;
  /** Ключ пересоздания iframe (его URL) — для перебинда слушателей. */
  srcKey: string | null;
  onPlayingChange: (playing: boolean) => void;
  /** Периодическая оценка позиции (сек), также на паузе и при размонтировании. */
  onTick: (positionSeconds: number) => void;
}

const TICK_MS = 5_000;
/** Нижняя полоса плеера с контролами: минимум в px и доля высоты. */
const CONTROL_STRIP_MIN_PX = 48;
const CONTROL_STRIP_RATIO = 0.15;
const FALLBACK_MAX_ACC_SECONDS = 6 * 3600;

export function useVideoseedEstimator({
  enabled,
  iframeRef,
  anchor,
  durationSeconds,
  srcKey,
  onPlayingChange,
  onTick,
}: EstimatorOptions) {
  // Колбэки держим в ref, чтобы их пересоздание не перезапускало эффект.
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!enabled) return;
    const el = iframeRef.current;
    if (!el) return;

    let playing = false;
    let accumulated = 0; // сыгранные секунды до последнего перехода
    let playStartedAt = 0;
    // Последняя позиция мыши на НАШЕЙ странице (внутри iframe события не видны,
    // так что это точка входа курсора в плеер). На touch остаётся неизвестной.
    let mouseX = -1;
    let mouseY = -1;

    const maxPosition = durationSeconds ? durationSeconds * 0.95 : null;
    const maxAccumulated = durationSeconds
      ? durationSeconds * 1.2
      : FALLBACK_MAX_ACC_SECONDS;

    const accNow = () =>
      accumulated + (playing ? (Date.now() - playStartedAt) / 1000 : 0);
    const estimate = () => {
      const pos = anchor + accNow();
      return maxPosition !== null ? Math.min(pos, maxPosition) : pos;
    };

    const setPlaying = (next: boolean) => {
      if (next === playing) return;
      accumulated = accNow();
      playStartedAt = Date.now();
      playing = next;
      onPlayingChangeRef.current(next);
      onTickRef.current(estimate());
    };

    // Возврат фокуса странице, чтобы следующий клик в плеер снова дал blur.
    const rearm = () => {
      if (document.activeElement === el) el.blur();
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const onWindowBlur = () => {
      // activeElement обновляется к следующему тику после blur.
      window.setTimeout(() => {
        if (document.activeElement !== el) return; // ушли не в плеер
        const rect = el.getBoundingClientRect();
        const strip = Math.max(
          CONTROL_STRIP_MIN_PX,
          rect.height * CONTROL_STRIP_RATIO,
        );
        const inControls =
          mouseX >= rect.left &&
          mouseX <= rect.right &&
          mouseY > rect.bottom - strip &&
          mouseY <= rect.bottom;
        // Клик по контролам (перемотка/громкость/качество) не тумблерим.
        // Неизвестная позиция (touch) трактуется как клик по центру.
        if (!inControls) setPlaying(!playing);
      }, 0);
    };

    const onFullscreenChange = () => {
      if (document.fullscreenElement === el) {
        // В полноэкран уходят чтобы смотреть; клик-триггер мог ошибочно
        // поставить «паузу» — переопределяем.
        setPlaying(true);
      } else {
        rearm();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') rearm();
    };

    const timer = window.setInterval(() => {
      if (accNow() > maxAccumulated) {
        // Защита от забытой вкладки: перестаём накручивать позицию.
        setPlaying(false);
        return;
      }
      if (playing) onTickRef.current(estimate());
    }, TICK_MS);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibility);
    el.addEventListener('mouseleave', rearm);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('mouseleave', rearm);
      // Финальная оценка — чтобы флаш прогресса при размонтировании ушёл
      // со свежей позицией.
      onTickRef.current(estimate());
      if (playing) onPlayingChangeRef.current(false);
    };
  }, [enabled, anchor, durationSeconds, srcKey, iframeRef]);
}

'use client';

import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

/** Пикселей движения курсора, после которых жест считается драгом, а не кликом. */
const DRAG_THRESHOLD = 6;

/** Пауза без колеса, после которой лента доводится до ближайшей карточки. */
const SETTLE_DELAY_MS = 650;

/**
 * Обёртка для горизонтальных каруселей («Продолжить просмотр» и т.п.).
 * Родная полоса прокрутки (см. .overflow-x-auto в globals.css) остаётся —
 * пользователь этой обёрткой получает ещё два способа скроллить, не таская
 * саму полоску мышью:
 *  - колесо мыши (вертикальный delta конвертируется в горизонтальный scroll);
 *  - зажать и потащить мышью (touch не трогаем — там уже нативный свайп).
 *
 * Порог в DRAG_THRESHOLD пикселей обязателен: обычный клик по карточке тоже
 * содержит пару пикселей дрожания курсора между down/up, и без порога это
 * уже сдвигало scrollLeft под курсором — ссылка под пальцем уезжала, клик по
 * ней не засчитывался браузером.
 *
 * justDraggedRef переживает pointerup (он сбрасывает drag-состояние раньше,
 * чем браузер синтезирует click) и гасится уже в onClickCapture — иначе
 * отпускание мыши над карточкой после настоящего перетаскивания открывало бы
 * её как обычный клик.
 */
/**
 * ВАЖНО про выравнивание: у карусели с scroll-snap ОБЯЗАН быть scroll-px,
 * равный её px. Иначе браузер приклеивает первую карточку к началу
 * прокручиваемой области, а она не учитывает padding — карусель молча
 * оказывается прокрученной ровно на величину отступа, и первая карточка
 * начинается не от линии заголовка, а от края экрана. Именно это и
 * происходило: scrollLeft = 16 при padding-left = 16.
 */
export default function ScrollCarousel({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; scrollLeft: number; pointerId: number } | null>(
    null,
  );
  const draggingRef = useRef(false);
  const justDraggedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let target: number | null = null;
    let raf: number | null = null;
    let restoreSnapWhenDone = false;
    /** Куда ехал жест: +1 вправо, -1 влево. Нужен доводке, см. settle(). */
    let direction = 0;

    const stop = () => {
      target = null;
      raf = null;
      if (restoreSnapWhenDone) {
        restoreSnapWhenDone = false;
        el.style.scrollSnapType = '';
      }
    };

    /** Плавно подтягивает scrollLeft к target. Экспоненциальное сглаживание:
     *  каждый кадр съедаем часть остатка, поэтому движение стартует быстро и
     *  мягко тормозит. Раньше колесо писало scrollLeft += deltaY прямо в
     *  обработчике — один щелчок мыши это сразу ~120px рывком, и лента
     *  дёргалась ступеньками. */
    const tick = () => {
      if (target === null) {
        raf = null;
        return;
      }

      const before = el.scrollLeft;
      const diff = target - before;

      if (Math.abs(diff) < 1) {
        el.scrollLeft = target;
        stop();
        return;
      }

      el.scrollLeft = before + diff * 0.18;

      // Предохранитель: цель может оказаться недостижимой (округление до
      // физических пикселей, упор в границу прокрутки). Без него цикл крутил
      // бы rAF вечно и НИКОГДА не возвращал snap — ровно это и случилось при
      // проверке: лента вставала в двух пикселях от нуля и залипала без
      // привязки к карточкам.
      if (Math.abs(el.scrollLeft - before) < 0.5) {
        stop();
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    const ensureAnimating = () => {
      if (raf === null) raf = requestAnimationFrame(tick);
    };

    /** Доводка до карточки после того, как колесо остановилось.
     *
     *  Доводим НЕ к ближайшей точке, а к ближайшей ПО ХОДУ ДВИЖЕНИЯ. Шаг
     *  карточки (~300px) больше одного щелчка колеса (~120px), поэтому
     *  ближайшей всегда оказывалась та, с которой начали, и лента упруго
     *  возвращалась назад — щелчок вообще ничего не прокручивал. */
    const settle = () => {
      const cards = Array.from(el.children) as HTMLElement[];
      if (cards.length === 0) {
        el.style.scrollSnapType = '';
        return;
      }

      // Позицию считаем через getBoundingClientRect, а не offsetLeft:
      // offsetLeft отсчитывается от ближайшего ПОЗИЦИОНИРОВАННОГО предка, а у
      // карусели position не задан — значит от кого-то выше по дереву, и к
      // scrollLeft он отношения не имеет. С offsetLeft доводка промахивалась
      // и лента вставала между карточками (проверено вживую).
      // Отступ контейнера (px-4) НЕ вычитаем: snap-start прижимает карточку
      // к границе padding-box, то есть точка привязки браузера включает его
      // в себя. Пока вычитали — мы доводили на 16px левее, а восстановленный
      // snap тут же поправлял ленту обратно, и в самом конце жеста был
      // заметный подскок.
      const base = el.getBoundingClientRect().left - el.scrollLeft;
      const max = el.scrollWidth - el.clientWidth;
      const current = el.scrollLeft;

      const positions = cards
        .map((c) => c.getBoundingClientRect().left - base)
        .map((p) => Math.max(0, Math.min(max, p)));

      let best: number | null = null;
      for (const pos of positions) {
        if (direction > 0 && pos > current + 1) {
          if (best === null || pos < best) best = pos;
        } else if (direction < 0 && pos < current - 1) {
          if (best === null || pos > best) best = pos;
        }
      }
      // Ехали к самому краю — там следующей карточки нет, доводим к ближайшей.
      if (best === null) {
        best = positions.reduce(
          (acc, pos) => (Math.abs(pos - current) < Math.abs(acc - current) ? pos : acc),
          positions[0],
        );
      }

      target = best;
      restoreSnapWhenDone = true;
      ensureAnimating();
    };

    // React вешает onWheel как passive-слушатель (перформанс скролла по
    // умолчанию с React 17) — preventDefault() внутри JSX-пропа тихо не
    // срабатывает («Unable to preventDefault inside passive event listener»),
    // и страница продолжает скроллиться вертикально параллельно с каруселью.
    // Единственный способ реально погасить дефолт — навесить нативный
    // addEventListener с explicit passive: false в обход React.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      // Только доминирующий вертикальный скролл (обычное колесо) — трекпад
      // сам шлёт горизонтальный deltaX, его перехватывать не нужно.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

      // CSS scroll-snap (snap-x у карточек) гасит программные сдвиги
      // scrollLeft — браузер синхронно откатывает позицию к текущей
      // snap-точке раньше, чем следующий кадр успевает накопить движение, и
      // карусель выглядит залипшей (проверено вживую). Поэтому на время
      // жеста snap выключаем, а доводим до карточки сами, см. settle().
      el.style.scrollSnapType = 'none';

      const max = el.scrollWidth - el.clientWidth;
      direction = Math.sign(e.deltaY) || direction;
      target = Math.max(0, Math.min(max, (target ?? el.scrollLeft) + e.deltaY));
      ensureAnimating();
      e.preventDefault();

      if (settleTimer) clearTimeout(settleTimer);
      // Пауза, а не «сразу как перестали крутить»: доводка, срабатывающая
      // через ~140 мс, перехватывала ленту посреди серии щелчков —
      // пользователь ещё крутит, а она уже тащит к карточке.
      settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (settleTimer) clearTimeout(settleTimer);
      if (raf !== null) cancelAnimationFrame(raf);
      restoreSnapWhenDone = false;
    };
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // Драг мышью — свайп пальцем на тачскрине уже работает нативно.
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    // Pointer capture НЕ берём сразу — иначе обычный клик по ссылке внутри
    // может не дойти до неё. Захватываем, только если движение реально
    // превысит порог (см. onPointerMove).
    // Снимаем snap на время драга по той же причине, что и у колеса, и
    // заодно обрываем возможную доводку — иначе она тянула бы ленту к своей
    // цели, пока пользователь тащит её мышью в другую сторону.
    el.style.scrollSnapType = 'none';
    drag.current = { startX: e.clientX, scrollLeft: el.scrollLeft, pointerId: e.pointerId };
    draggingRef.current = false;
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const state = drag.current;
    if (!el || !state) return;
    const delta = e.clientX - state.startX;
    if (!draggingRef.current) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;
      draggingRef.current = true;
      justDraggedRef.current = true;
      el.setPointerCapture(state.pointerId);
    }
    el.scrollLeft = state.scrollLeft - delta;
    e.preventDefault();
  }, []);

  const endDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) ref.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
    draggingRef.current = false;
    // Отпустили — возвращаем snap, он аккуратно доведёт до карточки сам.
    if (ref.current) ref.current.style.scrollSnapType = '';
  }, []);

  const onClickCapture = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
      className={['cursor-grab select-none', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}

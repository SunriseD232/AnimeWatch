'use client';

import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

/** Пикселей движения курсора, после которых жест считается драгом, а не кликом. */
const DRAG_THRESHOLD = 6;

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
export default function ScrollCarousel({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; scrollLeft: number; pointerId: number } | null>(
    null,
  );
  const draggingRef = useRef(false);
  const justDraggedRef = useRef(false);

  // React вешает onWheel как passive-слушатель (перформанс скролла по
  // умолчанию с React 17) — preventDefault() внутри JSX-пропа тихо не
  // срабатывает («Unable to preventDefault inside passive event listener»),
  // и страница продолжает скроллиться вертикально параллельно с каруселью.
  // Единственный способ реально погасить дефолт — навесить нативный
  // addEventListener с explicit passive: false в обход React.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let snapRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      // Только доминирующий вертикальный скролл (обычное колесо) — трекпад
      // сам шлёт горизонтальный deltaX, его перехватывать не нужно.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // CSS scroll-snap (snap-x у карточек, см. использование этого
      // компонента) гасит инкрементальные scrollLeft += из колеса — браузер
      // синхронно откатывает позицию назад к текущей snap-точке раньше, чем
      // следующий тик колеса успевает накопить сдвиг, и карусель выглядит
      // залипшей (проверено вживую: 3 подряд += без отключения snap не
      // сдвигали scrollLeft вообще, с отключением — сдвигали штатно).
      // Драг мышью (см. onPointerMove) этим не страдает — там абсолютное
      // присваивание, а не инкремент, поэтому snap его не откатывает.
      // Отключаем snap на время активной прокрутки колесом, возвращаем
      // после паузы — чтобы карточки всё равно аккуратно доезжали до snap
      // после того, как пользователь перестал крутить колесо.
      el.style.scrollSnapType = 'none';
      el.scrollLeft += e.deltaY;
      e.preventDefault();
      if (snapRestoreTimer) clearTimeout(snapRestoreTimer);
      snapRestoreTimer = setTimeout(() => {
        el.style.scrollSnapType = '';
      }, 150);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (snapRestoreTimer) clearTimeout(snapRestoreTimer);
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

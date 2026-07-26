'use client';

import { useCallback, useRef, type PointerEvent, type ReactNode, type WheelEvent } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * Обёртка для горизонтальных каруселей («Продолжить просмотр» и т.п.).
 * Родная полоса прокрутки (см. .overflow-x-auto в globals.css) остаётся —
 * пользователь этой обёрткой получает ещё два способа скроллить, не таская
 * саму полоску мышью:
 *  - колесо мыши (вертикальный delta конвертируется в горизontal scroll);
 *  - зажать и потащить мышью (touch не трогаем — там уже нативный свайп).
 */
export default function ScrollCarousel({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; scrollLeft: number } | null>(null);

  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    // Только доминирующий вертикальный скролл (обычное колесо) — трекпад
    // сам шлёт горизонтальный deltaX, его перехватывать не нужно.
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // Драг мышью — свайп пальцем на тачскрине уже работает нативно.
    if (e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    drag.current = { startX: e.clientX, scrollLeft: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.scrollLeft - (e.clientX - drag.current.startX);
  }, []);

  const endDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    ref.current?.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      ref={ref}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={['cursor-grab select-none active:cursor-grabbing', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

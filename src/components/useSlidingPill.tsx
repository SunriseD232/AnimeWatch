'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Ползунок под активной вкладкой сегментированного переключателя.
 *
 * Зачем отдельным слоем, а не заливкой самой вкладки: так подсветка
 * ПЕРЕЕЗЖАЕТ между вкладками одним движением, а не гаснет на одной и
 * зажигается на другой. Разница заметная — второе читается как мигание.
 *
 * Зачем мерить, а не считать долю: подписи разной длины («Аниме» против
 * «Фильмы и сериалы»), и ползунок фиксированной ширины либо не докрывал бы
 * длинную, либо торчал бы за короткую.
 *
 * Общий код для главной (ModeSwitch) и профиля (UserListView): переключатель
 * там один и тот же по смыслу, отличается только тем, ссылки это или
 * состояние.
 */
export function useSlidingPill(active: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  /** ref-колбэк для вкладки: `ref={setTabRef('anime')}`. */
  const setTabRef = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      tabRefs.current[key] = el;
    },
    [],
  );

  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const el = tabRefs.current[active];
      if (!root || !el) return;
      const r = root.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      setPill({ left: t.left - r.left, width: t.width });
    };
    measure();

    // Ширина подписи меняется от шрифта, а положение — от ширины окна: без
    // наблюдателя ползунок разъезжался с вкладкой. Считаем и содержимое:
    // в профиле у вкладок есть счётчик, и он меняет ширину на лету.
    const observer = new ResizeObserver(measure);
    const root = rootRef.current;
    if (root) {
      observer.observe(root);
      for (const el of Object.values(tabRefs.current)) if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [active]);

  return { rootRef, setTabRef, pill };
}

/** Сам ползунок. Пока не измерен — не рисуется вовсе: иначе первый кадр
 *  показал бы его в левом углу и он бы «прыгнул» на место. */
export function SlidingPill({ pill }: { pill: { left: number; width: number } | null }) {
  if (!pill) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute top-1 z-0 rounded-full bg-accent transition-[transform,width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{
        height: 'calc(100% - 0.5rem)',
        width: pill.width,
        transform: `translateX(${pill.left}px)`,
        left: 0,
      }}
    />
  );
}

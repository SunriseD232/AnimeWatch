'use client';

import { useEffect, useState, type RefObject } from 'react';

interface Props {
  expanded: boolean;
  onToggle: () => void;
  /** Ref на обрезаемый (line-clamp) заголовок — кнопка появляется, только
   * если он реально не влез и обрезался. */
  titleRef: RefObject<HTMLElement>;
}

/**
 * Кнопка «i»: раскрывает обрезанное (line-clamp) название карточки целиком,
 * без перехода на страницу тайтла. Ставится СНАРУЖИ оборачивающего <Link>
 * как отдельный сосед (как кнопка удаления в ContinueCard) — вложенный
 * <button> внутри <a> ломает html-семантику и может путать скринридеры.
 *
 * Видна только когда заголовок реально обрезан (scrollHeight > clientHeight
 * при активном line-clamp) — короткие названия, которые и так влезли
 * целиком, кнопку не показывают вовсе.
 */
export default function ExpandTitleButton({
  expanded,
  onToggle,
  titleRef,
}: Props) {
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    // В развёрнутом состоянии line-clamp снят, clientHeight равен
    // scrollHeight независимо от того, обрезалось ли название раньше —
    // измерять в этот момент нельзя, просто сохраняем прошлый результат.
    if (expanded) return;
    const el = titleRef.current;
    if (!el) return;

    const check = () => setTruncated(el.scrollHeight > el.clientHeight + 1);
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [titleRef, expanded]);

  if (!truncated) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-label={expanded ? 'Свернуть название' : 'Показать полное название'}
      className="press absolute bottom-1.5 right-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-xs font-bold italic leading-none text-white backdrop-blur transition hover:bg-black/90"
    >
      {expanded ? '×' : 'i'}
    </button>
  );
}

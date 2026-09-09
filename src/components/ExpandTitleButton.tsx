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
      // Видимый значок остаётся 24×24 (WCAG-минимум впритык), но область
      // нажатия расширена до ~40×40 псевдоэлементом — карточки в основном
      // листают с телефона, а на границе минимума нет запаса на неточный тап.
      className="press absolute bottom-1.5 right-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/70 leading-none text-white backdrop-blur transition before:absolute before:inset-[-8px] before:content-[''] hover:bg-black/90"
    >
      {/* Значки лежат друг на друге и меняются поворотом с растворением, а не
          подменой символа: мгновенная замена «i» на «×» читалась как дефект
          отрисовки.

          Курсивная «i» смещена на пол-пикселя влево: наклон уводит её
          видимый центр вправо, и в идеально отцентрованном боксе она
          выглядела прижатой к правому краю кружка. Компенсация именно у
          неё — у «×» наклона нет и смещать её не нужно. */}
      <span className="relative block h-3.5 w-3.5">
        <span
          aria-hidden="true"
          className={`absolute inset-0 grid -translate-x-[0.5px] place-items-center text-xs font-bold italic transition-all duration-200 ${
            expanded ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
          }`}
        >
          i
        </span>
        <span
          aria-hidden="true"
          className={`absolute inset-0 grid place-items-center text-sm font-bold transition-all duration-200 ${
            expanded ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
          }`}
        >
          ×
        </span>
      </span>
    </button>
  );
}

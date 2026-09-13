'use client';

import { useEffect, useState, type RefObject } from 'react';
import { InfoIcon, XIcon } from '@/components/social/icons';

interface Props {
  expanded: boolean;
  onToggle: () => void;
  /** Ref на обрезаемый (line-clamp) заголовок — кнопка появляется, только
   * если он реально не влез и обрезался. */
  titleRef: RefObject<HTMLElement>;
  /** false — кнопка без собственного абсолютного позиционирования: её
   *  раскладывает родитель-флекс (см. CardActions, где рядом стоит «+»).
   *  По умолчанию true — как раньше, сама себя ставит в угол карточки. */
  standalone?: boolean;
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
  standalone = true,
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
      // Тот же вид, что кнопки в уведомлениях: матовый кружок фона карточки,
      // серый значок — вместо курсивной буквы в чёрной обводке. Область
      // нажатия расширена псевдоэлементом до ~44px: карточки листают с
      // телефона, на 28px нет запаса на неточный тап.
      className={[
        'press z-10 grid h-7 w-7 place-items-center rounded-full bg-bg-card/80 text-gray-300 backdrop-blur transition',
        "before:absolute before:inset-[-8px] before:content-['']",
        'hover:bg-white/10 hover:text-white',
        standalone ? 'absolute bottom-1.5 right-1.5' : 'relative',
      ].join(' ')}
    >
      {/* Значки лежат друг на друге и меняются поворотом с растворением, а не
          подменой: мгновенная замена «i» на «×» читалась как дефект. */}
      <span className="relative block h-4 w-4">
        <InfoIcon
          className={`absolute inset-0 h-4 w-4 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
            expanded ? 'scale-[0.4] opacity-0' : 'scale-100 opacity-100'
          }`}
        />
        <XIcon
          className={`absolute inset-0 h-4 w-4 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
            expanded ? 'scale-100 opacity-100' : 'scale-[0.4] opacity-0'
          }`}
        />
      </span>
    </button>
  );
}

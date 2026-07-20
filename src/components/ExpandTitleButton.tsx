'use client';

interface Props {
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Кнопка «⋯»: раскрывает обрезанное (line-clamp) название карточки целиком,
 * без перехода на страницу тайтла. Ставится СНАРУЖИ оборачивающего <Link>
 * как отдельный сосед (как кнопка удаления в ContinueCard) — вложенный
 * <button> внутри <a> ломает html-семантику и может путать скринридеры.
 *
 * Всегда видима (не по hover): на мобильном hover не срабатывает вовсе,
 * а полное название нужно в первую очередь там, где текст обрезан на
 * маленьком экране.
 */
export default function ExpandTitleButton({ expanded, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-label={expanded ? 'Свернуть название' : 'Показать полное название'}
      className="press absolute bottom-1.5 right-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-xs font-bold leading-none text-white backdrop-blur transition hover:bg-black/90"
    >
      {expanded ? '×' : '⋯'}
    </button>
  );
}

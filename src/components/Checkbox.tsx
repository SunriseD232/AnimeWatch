interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/**
 * Чекбокс с собственной отрисовкой вместо нативного браузерного вида —
 * native <input type="checkbox"> в невыбранном состоянии рисуется системным
 * виджетом (светлый квадрат на Windows/большинстве браузеров), который не
 * подчиняется тёмной теме и выбивается на фоне остального интерфейса.
 * Сам input остаётся в разметке (доступность, фокус, клавиатура) — просто
 * визуально скрыт, а видимую рамку/галочку рисует соседний span.
 */
export default function Checkbox({ checked, onChange, label }: Props) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-400">
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span className="pointer-events-none absolute inset-0 rounded border border-white/20 bg-bg-card transition peer-checked:border-accent peer-checked:bg-accent" />
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="pointer-events-none relative h-3 w-3 fill-none stroke-white stroke-[2.5] opacity-0 transition peer-checked:opacity-100"
        >
          <path d="M3.5 8.5 6.5 11.5 12.5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {label}
    </label>
  );
}

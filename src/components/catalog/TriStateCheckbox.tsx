'use client';

/**
 * Чекбокс с тремя состояниями: пусто → включено (галка, акцент) → исключено
 * (крестик, красный, зачёркнутая подпись) → снова пусто.
 *
 * Отдельный компонент, а не Checkbox из components/Checkbox.tsx: тому хватает
 * boolean, а нативный `indeterminate` третьим состоянием тут не годится —
 * «исключить» это не «частично выбрано», и на клавиатуре/скринридере оно
 * должно читаться иначе. Отсюда же button + aria-pressed="mixed" вместо
 * input[type=checkbox]: у чекбокса нет валидного способа сообщить «выбрано
 * отрицательно».
 *
 * Визуально повторяет Checkbox (тот же квадрат 16px, та же рамка), чтобы
 * группы в сайдбаре читались как обычные чекбоксы — ими они и являются,
 * исключение просто дополнительный шаг.
 */
export default function TriStateCheckbox({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: 'off' | 'include' | 'exclude';
  onToggle: () => void;
}) {
  const included = state === 'include';
  const excluded = state === 'exclude';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={included ? true : excluded ? 'mixed' : false}
      title={
        excluded
          ? `${label} — исключено (нажмите, чтобы снять)`
          : included
            ? `${label} — включено (нажмите, чтобы исключить)`
            : label
      }
      className="press flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm transition hover:bg-white/5"
    >
      <span
        aria-hidden="true"
        className={[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
          included
            ? 'border-accent bg-accent'
            : excluded
              ? 'border-red-500/60 bg-red-500/20'
              : 'border-white/20 bg-bg-card',
        ].join(' ')}
      >
        {included && (
          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-accent-fg stroke-[2.5]">
            <path d="M3.5 8.5 6.5 11.5 12.5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {excluded && (
          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-red-300 stroke-[2.5]">
            <path d="M4 4 12 12M12 4 4 12" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span
        className={
          excluded
            ? 'text-red-300 line-through'
            : included
              ? 'text-gray-100'
              : 'text-gray-400'
        }
      >
        {label}
      </span>
    </button>
  );
}

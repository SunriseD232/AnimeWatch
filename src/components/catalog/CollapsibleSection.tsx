'use client';

import { useId, useState } from 'react';

/**
 * Раскрывающаяся секция мобильной панели фильтров.
 *
 * Все секции по умолчанию свёрнуты: групп шесть, и развёрнутыми они дают
 * длинную простыню, по которой надо скроллить, чтобы понять, что вообще
 * можно настроить. Свёрнутые — это короткое оглавление в один экран.
 *
 * Отсюда же счётчик у заголовка: у свёрнутой секции выбранное иначе не
 * видно совсем, и легко забыть про уже стоящий фильтр, который режет выдачу.
 *
 * Не <details>/<summary>: их нативное поведение не даёт анимировать
 * раскрытие и по-разному выглядит в браузерах, а тут это заметная часть
 * ощущения «шторки».
 */
export default function CollapsibleSection({
  title,
  count = 0,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Сколько пунктов выбрано — бейдж у заголовка, когда секция свёрнута. */
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="press flex w-full items-center justify-between gap-2 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-100">{title}</span>
          {count > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
              {count}
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 fill-none stroke-gray-400 stroke-2 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Содержимое размонтируется при сворачивании — держать в DOM все
          шесть групп (в том числе 40+ чипов жанров) ради анимации не стоит:
          на телефоне это заметно и по памяти, и по времени первой отрисовки. */}
      {open && (
        <div id={panelId} className="pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

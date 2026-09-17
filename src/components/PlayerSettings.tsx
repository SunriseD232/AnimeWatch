'use client';

import { useEffect, useId, useState } from 'react';
import {
  DEFAULT_QUALITY,
  MAX_QUALITY,
  QUALITY_OPTIONS,
  readPreferredQuality,
  storePreferredQuality,
  type PreferredQuality,
} from '@/lib/playerQuality';

const HINTS: Record<PreferredQuality, string> = {
  480: 'Экономит трафик, быстрее стартует',
  720: 'Баланс качества и трафика',
  1080: 'Максимальное доступное у источника',
};

/**
 * Настройки плеера: качество видео по умолчанию.
 *
 * Значение читаем в эффекте, а не при первом рендере: localStorage на
 * сервере нет, и обращение к нему в теле компонента разъехалось бы с
 * серверной разметкой при гидратации. До первого эффекта показываем
 * значение по умолчанию — оно же и стоит у того, кто настройку не трогал.
 */
export default function PlayerSettings() {
  const [quality, setQuality] = useState<PreferredQuality>(DEFAULT_QUALITY);
  const headingId = useId();
  const descId = useId();

  useEffect(() => setQuality(readPreferredQuality()), []);

  function change(next: PreferredQuality) {
    setQuality(next);
    storePreferredQuality(next);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5 sm:p-5"
    >
      <div>
        <h3 id={headingId} className="text-base font-semibold text-gray-100">
          Качество по умолчанию
        </h3>
        <p id={descId} className="mt-0.5 text-sm text-gray-400">
          С какого качества начинать просмотр. В самом плеере его можно сменить на любую серию — там же
          есть «Авто».
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        aria-describedby={descId}
        className="grid gap-2 sm:grid-cols-3"
        onKeyDown={(e) => {
          // Та же модель, что у радиогруппы приватности: Tab попадает на
          // выбранный вариант, стрелки переключают между вариантами.
          const step =
            e.key === 'ArrowRight' || e.key === 'ArrowDown'
              ? 1
              : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                ? -1
                : 0;
          if (!step) return;
          e.preventDefault();
          const index = QUALITY_OPTIONS.indexOf(quality);
          const next = QUALITY_OPTIONS[(index + step + QUALITY_OPTIONS.length) % QUALITY_OPTIONS.length];
          change(next);
          const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
          buttons[(index + step + QUALITY_OPTIONS.length) % QUALITY_OPTIONS.length]?.focus();
        }}
      >
        {QUALITY_OPTIONS.map((option) => {
          const selected = quality === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => change(option)}
              className={[
                'press flex flex-col items-start gap-0.5 rounded-xl p-3 text-left ring-1 transition',
                selected ? 'bg-accent/10 ring-accent/60' : 'bg-bg-soft ring-white/5 hover:ring-white/20',
              ].join(' ')}
            >
              <span className="text-sm font-semibold text-gray-100">
                {option}p{option === MAX_QUALITY ? ' и выше' : ''}
              </span>
              <span className="text-xs text-gray-400">{HINTS[option]}</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-gray-400">
        У разных источников свой набор качеств. Если выбранного нет, плеер возьмёт ближайшее — не выше
        выбранного, а если всё выше, то самое низкое доступное. Настройка сохраняется на этом устройстве.
      </p>
    </section>
  );
}

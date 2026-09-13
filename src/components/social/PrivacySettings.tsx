'use client';

import { useId, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import type { PrivacySettings as Privacy, Visibility } from '@/lib/social/types';
import { GlobeIcon, LockIcon, UsersIcon } from './icons';

/**
 * Вкладка «Приватность»: кто видит список и оценки.
 *
 * Сохраняется сразу по выбору, без отдельной кнопки: переключатель из трёх
 * положений, и промежуточного «выбрал, но не сохранил» тут не бывает —
 * ровно так же работает оформление во вкладке UI.
 */

const OPTIONS: { value: Visibility; label: string; hint: string; Icon: typeof GlobeIcon }[] = [
  { value: 'everyone', label: 'Все', hint: 'Любой вошедший на сайт', Icon: GlobeIcon },
  { value: 'friends', label: 'Друзья', hint: 'Только те, кто у вас в друзьях', Icon: UsersIcon },
  { value: 'nobody', label: 'Никто', hint: 'Видно только вам', Icon: LockIcon },
];

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : fallback;
}

export default function PrivacySettings({ initial }: { initial: Privacy }) {
  const { toast } = useToast();
  const [privacy, setPrivacy] = useState(initial);
  const [saving, setSaving] = useState<keyof Privacy | null>(null);

  async function change(section: keyof Privacy, value: Visibility) {
    if (privacy[section] === value) return;
    const previous = privacy;
    setPrivacy({ ...privacy, [section]: value });
    setSaving(section);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(section === 'lists' ? { listsVisibility: value } : { ratingsVisibility: value }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Не удалось сохранить. Попробуйте ещё раз.'));
      const data = (await res.json()) as { privacy: Privacy };
      setPrivacy(data.privacy);
      toast('Сохранено', 'success');
    } catch (err) {
      setPrivacy(previous);
      toast(err instanceof Error ? err.message : 'Не удалось сохранить.', 'error');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Мой список"
        description="Что вы смотрите, пересматриваете, планируете и бросили — на вашей странице для других."
        value={privacy.lists}
        busy={saving === 'lists'}
        onChange={(v) => change('lists', v)}
      />
      <Section
        title="Мои оценки"
        description="Ваши оценки на вашей странице и в строке «Друзья оценили» на страницах тайтлов."
        value={privacy.ratings}
        busy={saving === 'ratings'}
        onChange={(v) => change('ratings', v)}
      />
      <p className="text-sm text-gray-400">
        Средняя оценка сайта у тайтла считается по всем оценкам, но в ней не видно, кто и что поставил.
        Комментарии к сериям видят все вошедшие.
      </p>
    </div>
  );
}

function Section({
  title,
  description,
  value,
  busy,
  onChange,
}: {
  title: string;
  description: string;
  value: Visibility;
  busy: boolean;
  onChange: (next: Visibility) => void;
}) {
  const headingId = useId();
  const descId = useId();
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={busy}
      className="flex flex-col gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5 sm:p-5"
    >
      <div>
        <h3 id={headingId} className="text-base font-semibold text-gray-100">
          {title}
        </h3>
        <p id={descId} className="mt-0.5 text-sm text-gray-400">
          {description}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        aria-describedby={descId}
        className="grid gap-2 sm:grid-cols-3"
        onKeyDown={(e) => {
          // Модель радиогруппы: Tab попадает на выбранный вариант, стрелки
          // переключают между вариантами.
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const index = OPTIONS.findIndex((o) => o.value === value);
          const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
          onChange(next.value);
          const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
          buttons[(index + step + OPTIONS.length) % OPTIONS.length]?.focus();
        }}
      >
        {OPTIONS.map(({ value: option, label, hint, Icon }) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option)}
              className={[
                'press flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition',
                selected ? 'bg-accent/10 ring-accent/60' : 'bg-bg-soft ring-white/5 hover:ring-white/20',
              ].join(' ')}
            >
              <Icon className={`mt-0.5 h-4 w-4 ${selected ? 'text-accent-text' : 'text-gray-400'}`} />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-gray-100">{label}</span>
                <span className="text-xs text-gray-400">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

'use client';

import { useEffect, useId, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import {
  DEFAULT_QUALITY,
  QUALITY_OPTIONS,
  readPreferredQuality,
  storePreferredQuality,
  type PlayerPrefs,
  type PreferredQuality,
} from '@/lib/playerQuality';

const LABELS: Record<PreferredQuality, string> = {
  auto: 'Авто',
  480: '480p',
  720: '720p',
  1080: '1080p',
};

const HINTS: Record<PreferredQuality, string> = {
  auto: 'Плеер подберёт под скорость',
  480: 'Экономит трафик, быстрее стартует',
  720: 'Баланс качества и трафика',
  1080: 'Самое высокое у источника',
};

/**
 * Настройки плеера: качество по умолчанию и синхронизация выбора между
 * устройствами.
 *
 * Качество всегда пишется в localStorage — плеер читает его синхронно, в
 * обработчике манифеста hls.js, где ждать сеть негде. При включённой
 * синхронизации оно вдобавок уходит в аккаунт, и другие устройства
 * подхватывают его на следующей загрузке страницы (см. PlayerPrefsSync).
 *
 * Локальное значение читаем в эффекте, а не в теле компонента: localStorage
 * на сервере нет, и обращение к нему при рендере разъехалось бы с серверной
 * разметкой при гидратации.
 */
export default function PlayerSettings({ initial }: { initial: PlayerPrefs }) {
  const { toast } = useToast();
  const [quality, setQuality] = useState<PreferredQuality>(initial.quality ?? DEFAULT_QUALITY);
  const [sync, setSync] = useState(initial.sync);
  const [saving, setSaving] = useState(false);
  const headingId = useId();
  const descId = useId();

  // С выключенной синхронизацией показываем то, что реально стоит на этом
  // устройстве; с включённой — значение из аккаунта, оно главнее.
  useEffect(() => {
    if (!initial.sync || initial.quality == null) setQuality(readPreferredQuality());
  }, [initial.sync, initial.quality]);

  async function save(patch: { preferredQuality?: PreferredQuality; syncPlayerQuality?: boolean }) {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Не удалось сохранить. Попробуйте ещё раз.');
      }
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сохранить.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function changeQuality(next: PreferredQuality) {
    setQuality(next);
    storePreferredQuality(next);
    // В аккаунт — только когда синхронизация включена: иначе выбор на одном
    // устройстве молча менял бы его на всех остальных.
    if (sync) void save({ preferredQuality: next });
  }

  async function toggleSync(next: boolean) {
    setSync(next);
    // Включили — сразу кладём в аккаунт текущий выбор этого устройства,
    // иначе синхронизировать было бы нечего до следующей смены качества.
    const ok = await save(next ? { syncPlayerQuality: true, preferredQuality: quality } : { syncPlayerQuality: false });
    if (!ok) {
      setSync(!next);
      return;
    }
    toast(next ? 'Качество синхронизируется между устройствами' : 'Синхронизация выключена', 'success');
  }

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby={headingId}
        aria-busy={saving}
        className="flex flex-col gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5 sm:p-5"
      >
        <div>
          <h3 id={headingId} className="text-base font-semibold text-gray-100">
            Качество по умолчанию
          </h3>
          <p id={descId} className="mt-0.5 text-sm text-gray-400">
            С какого качества начинать просмотр. В самом плеере его можно сменить на любую серию — там
            же есть «Авто».
          </p>
        </div>
        <div
          role="radiogroup"
          aria-labelledby={headingId}
          aria-describedby={descId}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
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
            changeQuality(next);
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
                onClick={() => changeQuality(option)}
                className={[
                  'press flex flex-col items-start gap-0.5 rounded-xl p-3 text-left ring-1 transition',
                  selected ? 'bg-accent/10 ring-accent/60' : 'bg-bg-soft ring-white/5 hover:ring-white/20',
                ].join(' ')}
              >
                <span className="text-sm font-semibold text-gray-100">{LABELS[option]}</span>
                <span className="text-xs text-gray-400">{HINTS[option]}</span>
              </button>
            );
          })}
        </div>
        <p className="text-sm text-gray-400">
          У разных источников свой набор качеств. Если выбранного нет, плеер возьмёт ближайшее — не выше
          выбранного, а если всё выше, то самое низкое доступное.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5 sm:p-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-base font-semibold text-gray-100">
              Синхронизировать между устройствами
            </span>
            <span className="mt-0.5 block text-sm text-gray-400">
              Выключено — качество живёт только на этом устройстве: на телефоне по мобильному интернету
              и дома на большом экране разумный выбор обычно разный. Включено — выбор общий, остальные
              устройства подхватят его при следующем открытии сайта.
            </span>
          </span>
          {/* Переключатель на чекбоксе, а не на кнопке: так он читается
              скринридером как «флажок, включено/выключено» без ARIA-ручек. */}
          <input
            type="checkbox"
            checked={sync}
            disabled={saving}
            onChange={(e) => void toggleSync(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-accent disabled:opacity-50"
          />
        </label>
      </section>
    </div>
  );
}

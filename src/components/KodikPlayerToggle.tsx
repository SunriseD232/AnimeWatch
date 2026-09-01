'use client';

import { useState } from 'react';

interface Props {
  initialEnabled: boolean;
}

/**
 * Только для админов (см. lib/admin.ts) — живой рубильник вкладки «Kodik» в
 * переключателе плеера (см. lib/settings.ts, components/Player.tsx). Убрана
 * из выбора по умолчанию (осталась только как гарантированный запасной
 * вариант, если вообще ничего другого не резолвнулось) — этот тумблер
 * возвращает её как обычную вкладку без редеплоя, если понадобится.
 */
export default function KodikPlayerToggle({ initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    if (next === enabled || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/kodik-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить');
      setEnabled(next);
    } catch {
      setError('Не удалось сохранить — попробуйте ещё раз');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-bg-card p-4 text-sm">
      <p className="font-semibold text-gray-100">Вкладка «Kodik» в плеере</p>
      <p className="mt-1 text-gray-400">
        Показывать Kodik как обычный выбор в переключателе плеера (кино). Сейчас убрана из
        переключателя — остаётся только как запасной вариант, если вообще ничего другого не
        резолвнулось.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <label className="flex items-center gap-2 text-gray-200">
          <input
            type="radio"
            name="kodik-player-enabled"
            checked={enabled}
            onChange={() => change(true)}
            disabled={saving}
          />
          Включено
        </label>
        <label className="flex items-center gap-2 text-gray-200">
          <input
            type="radio"
            name="kodik-player-enabled"
            checked={!enabled}
            onChange={() => change(false)}
            disabled={saving}
          />
          Выключено
        </label>
        {saving && <span className="text-xs text-gray-400">Сохраняем…</span>}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

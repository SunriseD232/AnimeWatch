'use client';

import { useState } from 'react';

interface Props {
  initialEnabled: boolean;
}

/**
 * Только для админов (см. lib/admin.ts) — живой рубильник relay через VPS
 * (см. lib/settings.ts, lib/extract/proxy.ts): байты некоторых источников
 * (Sibnet/CVH/Videoseed/Aksor/Kodik — см. RELAY_HOSTS) идут через /relay на
 * VPS вместо прямого запроса, если апстрим блокирует IP текущей
 * инфраструктуры приложения. Сейчас приложение само на VPS, поэтому relay
 * избыточен, но кнопка — на случай переезда обратно на инфраструктуру с
 * блокируемым IP (Vercel и т.п.), без редеплоя.
 */
export default function RelayToggle({ initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    if (next === enabled || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/relay', {
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
      <p className="font-semibold text-gray-100">Relay через VPS</p>
      <p className="mt-1 text-gray-400">
        Проксирование байтов некоторых источников (Sibnet/CVH/Videoseed/Aksor/Kodik) через
        отдельный запрос к VPS вместо прямого — нужно только если апстримы блокируют IP
        приложения (например, снова на Vercel).
      </p>
      <div className="mt-3 flex items-center gap-4">
        <label className="flex items-center gap-2 text-gray-200">
          <input
            type="radio"
            name="relay-enabled"
            checked={enabled}
            onChange={() => change(true)}
            disabled={saving}
          />
          Включено
        </label>
        <label className="flex items-center gap-2 text-gray-200">
          <input
            type="radio"
            name="relay-enabled"
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

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/ToastProvider';

/**
 * Перезапуск общего Chromium на экстракторе (см. /api/admin/extractor).
 *
 * Зачем кнопка. Браузер и так меняется каждые 150 извлечений, но когда «плеер
 * грузится дольше обычного» прямо сейчас, ждать порога незачем. Раньше это
 * лечилось перезагрузкой всего сервера.
 *
 * Ждём ответа, а не отпускаем: сброс идёт через очередь и может подождать
 * текущее извлечение — это секунды, зато видно, что именно произошло.
 */
export default function ResetExtractorButton() {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/extractor', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        before?: { extractions?: number; ageMinutes?: number } | null;
      };
      if (!res.ok) {
        toast(data.message ?? 'Не удалось сбросить', 'error');
        return;
      }
      const was = data.before;
      toast(
        was?.extractions
          ? `Chromium перезапущен (было ${was.extractions} извлечений за ${was.ageMinutes} мин)`
          : 'Chromium перезапущен',
        'success',
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось сбросить', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={reset}
      disabled={busy}
      title="Закрыть текущий Chromium — новый поднимется на следующем извлечении"
      className="press shrink-0 rounded-full bg-bg-soft px-3 py-1 text-xs font-medium text-gray-200 transition hover:bg-white/10 disabled:opacity-50"
    >
      {busy ? 'Перезапускаю…' : 'Перезапустить Chromium'}
    </button>
  );
}

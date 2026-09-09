'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { JOBS, type JobName } from '@/lib/adminJobs';

/**
 * Кнопка ручного запуска фоновой джобы (см. /api/admin/run-job).
 *
 * Ответ приходит сразу — «запущено», а не «сделано»: сами прогоны идут от
 * минуты до полутора часов. Поэтому после запуска обновляем серверные данные
 * страницы (router.refresh) с задержкой: к этому моменту джоба уже успевает
 * проставить «Последний запуск начат», и человек видит подтверждение в тех же
 * строках, куда потом придёт результат.
 */
export default function RunJobButton({ job }: { job: JobName }) {
  const def = JOBS[job];
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/run-job', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast(data.message ?? 'Не удалось запустить', 'error');
        return;
      }
      toast(`Запущено: ${def.label.toLowerCase()} (${def.duration})`, 'success');
      // Секунда — чтобы джоба успела записать начало прогона; без задержки
      // страница перерисовалась бы старыми цифрами и выглядела бы так, будто
      // ничего не произошло.
      setTimeout(() => router.refresh(), 1000);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось запустить', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title={`Займёт ${def.duration}`}
      className="press shrink-0 rounded-full bg-bg-soft px-3 py-1 text-xs font-medium text-gray-200 transition hover:bg-white/10 disabled:opacity-50"
    >
      {busy ? 'Запускаю…' : 'Запустить'}
    </button>
  );
}

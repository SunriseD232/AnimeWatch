'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Предложение «открыть книгу с места из аудиокниги» (lib/syncOffers.ts) над
 * читалкой. Не прыгаем молча: место — оценка, человек мог и не хотеть
 * уходить со своего. «Остаться здесь» просто прячет плашку.
 *
 * «Открыть с этого места» сначала уточняет место по речи (этап 2,
 * /api/sync/refine, ~15 с): распознаёт, что прозвучало перед остановкой, и
 * находит это в тексте. Ждать не обязательно — рядом ссылка «Открыть сразу»
 * с оценкой этапа 1; ей же заканчивается и неудачное уточнение.
 */
export default function SyncBanner({
  text,
  baseHref,
  fraction,
  audiobookId,
  chapterIndex,
  position,
}: {
  text: string;
  /** Адрес читалки без ?from — к нему добавится доля текста. */
  baseHref: string;
  /** Оценка этапа 1. */
  fraction: number;
  audiobookId: number;
  chapterIndex: number;
  position: number;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<'idle' | 'working' | 'approx'>('idle');
  const approxHref = `${baseHref}?from=${fraction.toFixed(4)}`;

  async function openPrecise() {
    setState('working');
    try {
      const res = await fetch('/api/sync/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audiobookId, direction: 'toBook', chapterIndex, position }),
      });
      const data = (await res.json()) as { status?: string; fraction?: number };
      if (data.status === 'refined' && typeof data.fraction === 'number') {
        router.push(`${baseHref}?from=${data.fraction.toFixed(5)}`);
        return;
      }
    } catch {
      // Сеть или сервер — остаёмся на оценке.
    }
    setState('approx');
    router.push(approxHref);
  }

  if (hidden) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-2xl bg-accent/10 p-3 text-sm ring-1 ring-inset ring-accent/30 sm:flex-row sm:items-center"
    >
      <p className="flex-1 text-gray-100">
        {state === 'working'
          ? 'Уточняем место по записи — около 15 секунд…'
          : state === 'approx'
            ? 'Точнее найти не получилось — открываем примерное место.'
            : text}
      </p>
      <div className="flex shrink-0 gap-2">
        {state === 'idle' ? (
          <>
            <button
              type="button"
              onClick={() => void openPrecise()}
              className="press rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
            >
              Открыть с этого места
            </button>
            <button
              type="button"
              onClick={() => setHidden(true)}
              className="press rounded-full px-3 py-1.5 text-xs text-gray-300 ring-1 ring-white/15 hover:text-white"
            >
              Остаться здесь
            </button>
          </>
        ) : state === 'working' ? (
          <Link
            href={approxHref}
            prefetch={false}
            className="press rounded-full px-3 py-1.5 text-xs text-gray-300 ring-1 ring-white/15 hover:text-white"
          >
            Открыть сразу
          </Link>
        ) : null}
      </div>
    </div>
  );
}

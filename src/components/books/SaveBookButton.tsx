'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_SAVED_BOOKS } from '@/lib/bookShared';

/**
 * «Сохранить на сервере» на карточке книги (миграция 0058, lib/bookStorage.ts).
 *
 * Сохранение может идти десятки секунд: два файла с Флибусты через туннель.
 * Пока идёт — кнопка в полную силу со спиннером, а не «выключенная»: это
 * «делается», а не «нельзя».
 *
 * После успеха — router.refresh(): срок хранения и счётчик «N из 10»
 * считает сервер, и подставлять их здесь угадыванием незачем.
 */
export default function SaveBookButton({
  bookId,
  saved,
  expiresAt,
  savedCount,
}: {
  bookId: number;
  saved: boolean;
  /** ISO-дата, до которой книга хранится без чтения. */
  expiresAt: string | null;
  savedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: 'POST' | 'DELETE') {
    // Повторный клик во время сохранения не должен слать второй запрос.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/save`, { method });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(
          data?.message ??
            (method === 'POST'
              ? 'Не получилось сохранить книгу. Попробуйте ещё раз.'
              : 'Не получилось убрать книгу. Попробуйте ещё раз.'),
        );
        return;
      }
      router.refresh();
    } catch {
      setError('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  const until = expiresAt
    ? new Date(expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : null;
  const full = !saved && savedCount >= MAX_SAVED_BOOKS;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {saved ? (
          <button
            type="button"
            onClick={() => call('DELETE')}
            aria-busy={busy}
            className="press inline-flex items-center gap-2 rounded-full bg-bg-soft px-4 py-2.5 text-sm ring-1 ring-white/10 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {busy ? (
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : null}
            Убрать с сервера
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (full ? undefined : call('POST'))}
            aria-busy={busy}
            aria-disabled={full}
            className={[
              'press inline-flex items-center gap-2 rounded-full bg-bg-soft px-4 py-2.5 text-sm ring-1 ring-white/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              full ? 'cursor-not-allowed opacity-50' : 'hover:text-white',
            ].join(' ')}
          >
            {busy ? (
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : null}
            {busy ? 'Сохраняем…' : 'Сохранить на сервере'}
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        {saved
          ? `Книга на сервере и откроется, даже если Флибуста недоступна. Хранится до ${until ?? '—'}; срок продлевается, пока вы читаете.`
          : full
            ? `На сервере уже ${MAX_SAVED_BOOKS} ваших книг. Уберите одну, чтобы сохранить эту.`
            : `Сохранено ${savedCount} из ${MAX_SAVED_BOOKS}. Сохранённая книга откроется, даже если Флибуста недоступна.`}
      </p>

      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

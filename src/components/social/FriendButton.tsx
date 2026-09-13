'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import type { FriendshipState } from '@/lib/social/types';
import { ClockIcon, UserCheckIcon, UserPlusIcon } from './icons';

/**
 * Действия с дружбой для одного человека. Состояние после действия берётся
 * из ответа сервера, а не выводится здесь: «добавить» при встречной заявке
 * означает «принять», и угадывать это на клиенте — способ разойтись с базой.
 */

const primary =
  'press inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover';
const quiet =
  'press inline-flex min-h-10 items-center rounded-full px-3 py-2 text-sm font-medium text-gray-400 transition hover:bg-white/5 hover:text-gray-100';
const quietDanger =
  'press inline-flex min-h-10 items-center rounded-full px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10 hover:text-red-200';
const danger =
  'press inline-flex min-h-10 items-center rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700';

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : fallback;
}

export default function FriendButton({
  userId,
  name,
  initialState,
  onStateChange,
  refreshOnChange = false,
}: {
  userId: string;
  name: string;
  initialState: FriendshipState;
  onStateChange?: (next: FriendshipState) => void;
  /** Перерисовать серверную страницу (например, открыть оценки нового друга). */
  refreshOnChange?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (state === 'self') return null;

  async function send(method: 'POST' | 'DELETE', success: (next: FriendshipState) => string) {
    setBusy(true);
    try {
      const res = await fetch('/api/friends', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Не получилось. Попробуйте ещё раз.'));
      const data = (await res.json()) as { state: FriendshipState };
      setState(data.state);
      setConfirming(false);
      onStateChange?.(data.state);
      toast(success(data.state), 'success');
      if (refreshOnChange) router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не получилось. Попробуйте ещё раз.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    send('POST', (next) => (next === 'friends' ? `${name} теперь в друзьях` : `Заявка отправлена: ${name}`));

  if (state === 'none') {
    return (
      <button type="button" onClick={add} aria-busy={busy} className={primary}>
        <UserPlusIcon className="h-4 w-4" />
        {busy ? 'Отправляем…' : 'Добавить в друзья'}
      </button>
    );
  }

  if (state === 'incoming') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={add} aria-busy={busy} className={primary}>
          <UserCheckIcon className="h-4 w-4" />
          {busy ? 'Принимаем…' : 'Принять заявку'}
        </button>
        <button
          type="button"
          onClick={() => send('DELETE', () => 'Заявка отклонена')}
          className={quiet}
        >
          Отклонить
        </button>
      </div>
    );
  }

  if (state === 'outgoing') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-gray-300">
          <ClockIcon className="h-4 w-4" />
          Заявка отправлена
        </span>
        <button
          type="button"
          onClick={() => send('DELETE', () => 'Заявка отозвана')}
          aria-busy={busy}
          className={quiet}
        >
          Отозвать
        </button>
      </div>
    );
  }

  // friends
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Удалить ${name} из друзей`}>
        <span className="text-sm text-gray-300">Удалить из друзей?</span>
        <button
          type="button"
          onClick={() => send('DELETE', () => `${name} больше не в друзьях`)}
          aria-busy={busy}
          className={danger}
        >
          {busy ? 'Удаляем…' : 'Удалить'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={quiet}>
          Отмена
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-100">
        <UserCheckIcon className="h-4 w-4 text-accent" />
        В друзьях
      </span>
      <button type="button" onClick={() => setConfirming(true)} className={quietDanger}>
        Удалить из друзей
      </button>
    </div>
  );
}

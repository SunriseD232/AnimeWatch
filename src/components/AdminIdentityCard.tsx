'use client';

import Link from 'next/link';
import { useState } from 'react';
import Avatar from '@/components/social/Avatar';
import { useToast } from '@/components/ToastProvider';
import { ChevronRightIcon } from '@/components/social/icons';
import type { PublicUser } from '@/lib/social/types';

/**
 * Управление отображаемым именем пользователя глазами админа (см.
 * /admin/users/[id]). Показывает текущее имя и аватар, даёт переименовать
 * или снять имя (модерация), и ведёт в обычный публичный профиль /u/[id].
 *
 * Пишет через /api/admin/users/[id]/profile (service_role + проверка роли),
 * а не напрямую: у profiles нет политик на запись для authenticated.
 */
export default function AdminIdentityCard({ userId, initial }: { userId: string; initial: PublicUser }) {
  const { toast } = useToast();
  const [user, setUser] = useState(initial);
  const [value, setValue] = useState(user.hasCustomName ? user.name : '');
  const [saving, setSaving] = useState(false);

  async function save(displayName: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(data?.error ?? 'Не удалось сохранить.', 'error');
        return;
      }
      setUser(data.user as PublicUser);
      setValue((data.user as PublicUser).hasCustomName ? (data.user as PublicUser).name : '');
      toast(displayName ? 'Имя изменено' : 'Имя снято', 'success');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5">
      <div className="flex items-center gap-3">
        <Avatar user={user} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-100">{user.name}</p>
          <p className="text-xs text-gray-400">
            {user.hasCustomName ? 'Отображаемое имя задано пользователем' : 'Имя не задано — показывается запасная подпись'}
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(value.trim());
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={32}
          placeholder="Отображаемое имя"
          aria-label="Отображаемое имя пользователя"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-bg-soft px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-accent"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="press rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-50"
          >
            Сохранить
          </button>
          {user.hasCustomName && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save('')}
              className="press rounded-xl px-4 py-2.5 text-sm font-medium text-red-300 ring-1 ring-white/10 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              Снять имя
            </button>
          )}
        </div>
      </form>

      <Link
        href={`/u/${userId}`}
        className="press inline-flex items-center gap-1 self-start rounded-lg text-sm font-medium text-accent-text transition hover:underline"
      >
        Открыть публичный профиль
        <ChevronRightIcon className="h-4 w-4" />
      </Link>
    </section>
  );
}

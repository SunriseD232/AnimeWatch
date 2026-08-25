'use client';

import { useState } from 'react';
import { useToast } from '@/components/ToastProvider';

const GEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generatePassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += GEN_CHARS[Math.floor(Math.random() * GEN_CHARS.length)];
  }
  return out;
}

/**
 * Сброс пароля пользователя админом — единственный путь восстановить
 * доступ тому, кто забыл пароль (email-восстановление недоступно на этой
 * VPS, см. ChangePasswordCard). Пишет напрямую через service_role на
 * сервере (см. /api/admin/users/[id]/reset-password) — обычный клиентский
 * supabase.auth.updateUser меняет ТОЛЬКО пароль текущей сессии, чужой так
 * не поменять.
 */
export default function AdminResetPasswordCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast('Пароль должен быть не короче 6 символов', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      toast('Пароль изменён — сообщите его пользователю лично', 'success');
      setPassword('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-gray-200">Сбросить пароль</h2>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Новый пароль"
          minLength={6}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-bg-soft px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() => setPassword(generatePassword())}
          className="press rounded-lg border border-white/10 bg-bg-soft px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5 hover:text-white"
        >
          Сгенерировать
        </button>
        <button
          type="submit"
          disabled={saving || password.length < 6}
          className="press rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Пользователь не получит уведомление — email-рассылка на этой VPS не
        настроена, сообщите новый пароль лично.
      </p>
    </form>
  );
}

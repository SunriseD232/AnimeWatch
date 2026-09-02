'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';

/**
 * Форма смены пароля — раньше жила в модалке за кнопкой в шапке профиля (см.
 * git-историю ChangePasswordButton), теперь отдельная вкладка «Пароль» в
 * ProfileTabs.tsx: формой пользуются пару раз в год, отдельная вкладка её
 * проще найти, чем прятать за модалкой.
 */
export default function ChangePasswordForm() {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast('Пароль должен быть не короче 6 символов', 'error');
      return;
    }
    if (password !== confirm) {
      toast('Пароли не совпадают', 'error');
      return;
    }
    setSaving(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast('Пароль изменён', 'success');
      setPassword('');
      setConfirm('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-sm rounded-2xl border border-white/10 bg-bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold text-gray-100">Сменить пароль</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="Новый пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-white/10 bg-bg-soft px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="Повторите пароль"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="rounded-lg border border-white/10 bg-bg-soft px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={saving}
          className="press self-start rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';

/**
 * Кнопка «Сменить пароль» рядом с «Выйти» + модалка с формой — раньше это
 * была отдельная всегда открытая карточка вверху профиля, занимала место
 * ради формы, которой пользуются раз в год. Модалка — тот же паттерн, что
 * TrailerButton (focus-trap, Escape, клик по фону закрывает).
 */
export default function ChangePasswordButton() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  function close() {
    setOpen(false);
    setPassword('');
    setConfirm('');
  }

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
      close();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="press rounded-lg border border-white/10 bg-bg-card px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-bg-soft"
      >
        Сменить пароль
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={close}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Сменить пароль"
            tabIndex={-1}
            className="relative w-full max-w-sm rounded-2xl bg-bg-card p-5 shadow-2xl outline-none ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={close}
              aria-label="Закрыть"
              className="press absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-white/5 hover:text-white"
            >
              ✕
            </button>
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
                autoFocus
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
        </div>
      )}
    </>
  );
}

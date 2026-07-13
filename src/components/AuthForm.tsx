'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Mode = 'login' | 'signup';

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        // Если подтверждение email включено — сессии ещё нет.
        if (!data.session) {
          setInfo(
            'Аккаунт создан. Проверьте почту для подтверждения, затем войдите.',
          );
          setLoading(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      // Обновляем серверные компоненты и уходим на redirect.
      router.push(redirect);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Что-то пошло не так';
      setError(message);
      setLoading(false);
    }
  }

  const isLogin = mode === 'login';

  return (
    <div className="mx-auto mt-8 w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-bold">
        {isLogin ? 'Вход' : 'Регистрация'}
      </h1>
      <p className="mb-6 text-sm text-gray-400">
        {isLogin
          ? 'Войдите, чтобы синхронизировать прогресс между устройствами.'
          : 'Создайте аккаунт — прогресс просмотра сохранится в облаке.'}
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-300">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-white/10 bg-bg-card px-3 py-2.5 text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-300">Пароль</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-white/10 bg-bg-card px-3 py-2.5 text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        {error && (
          <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-200">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
        >
          {loading
            ? 'Подождите…'
            : isLogin
              ? 'Войти'
              : 'Зарегистрироваться'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-400">
        {isLogin ? (
          <>
            Нет аккаунта?{' '}
            <Link href="/signup" className="text-accent hover:underline">
              Регистрация
            </Link>
          </>
        ) : (
          <>
            Уже есть аккаунт?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Вход
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

type Mode = 'login' | 'signup';

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Слишком много попыток. Подождите минуту и попробуйте снова.',
  invalid_code: 'Неверный код приглашения.',
  bad_payload: 'Проверьте email и пароль.',
};

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const isLogin = mode === 'login';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(isLogin ? '/api/login' : '/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isLogin ? { email, password } : { email, password, code },
        ),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error] ?? data.error ?? 'Что-то пошло не так');
        setRemaining(typeof data.remaining === 'number' ? data.remaining : null);
        setLoading(false);
        return;
      }

      // Обновляем серверные компоненты (в т.ч. middleware-редиректы) и уходим.
      router.push(redirect);
      router.refresh();
    } catch {
      setError('Сетевая ошибка');
      setLoading(false);
    }
  }

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

        {!isLogin && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-300">Код приглашения</span>
            <input
              type="text"
              required
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="rounded-lg border border-white/10 bg-bg-card px-3 py-2.5 font-mono text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        )}

        {error && (
          <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200">
            {error}
            {remaining !== null && (
              <span className="mt-1 block text-xs text-red-300/80">
                {remaining > 0
                  ? `Осталось попыток: ${remaining}`
                  : 'Попыток больше нет — подождите минуту.'}
              </span>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-full press bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
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

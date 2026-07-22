import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTodaysSignupCode } from '@/lib/signupCode';

export const metadata = { title: 'Код регистрации — MediaWatch' };

// Единственный аккаунт, которому виден код приглашения.
const ADMIN_EMAIL = '2000gva@gmail.com';

/**
 * Страница видна только владельцу ADMIN_EMAIL — остальным (в т.ч. другим
 * авторизованным пользователям) отдаём notFound(), чтобы не палить даже сам
 * факт существования этой страницы.
 */
export default async function CodePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    notFound();
  }

  const code = getTodaysSignupCode();

  return (
    <div className="mx-auto mt-8 w-full max-w-sm">
      <h1 className="mb-1 text-xl font-bold">Код регистрации на сегодня</h1>
      <p className="mb-6 text-sm text-gray-400">
        Меняется автоматически раз в сутки, в полночь по UTC.
      </p>

      {code ? (
        <p className="rounded-lg border border-white/10 bg-bg-card px-4 py-3 text-center font-mono text-lg tracking-[0.15em] text-accent">
          {code}
        </p>
      ) : (
        <p className="rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-200">
          SIGNUP_CODE_SECRET не задан в окружении — регистрация сейчас
          заблокирована для всех.
        </p>
      )}
    </div>
  );
}

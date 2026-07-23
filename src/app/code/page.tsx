import { notFound } from 'next/navigation';
import SignupCodeCard from '@/components/SignupCodeCard';
import { isAdminEmail } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';
import { getTodaysSignupCode } from '@/lib/signupCode';

export const metadata = { title: 'Код регистрации — MediaWatch' };

/**
 * Страница видна только ADMIN_EMAILS (см. lib/admin.ts) — остальным (в т.ч.
 * другим авторизованным пользователям) отдаём notFound(), чтобы не палить
 * даже сам факт существования этой страницы. То же самое (без похода сюда)
 * доступно во вкладке «Код» в профиле — см. SignupCodeCard.
 */
export default async function CodePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email)) {
    notFound();
  }

  const code = getTodaysSignupCode();

  return (
    <div className="mx-auto mt-8 flex w-full max-w-sm flex-col items-center">
      <h1 className="mb-1 text-xl font-bold">Код регистрации на сегодня</h1>
      <SignupCodeCard code={code} />
    </div>
  );
}

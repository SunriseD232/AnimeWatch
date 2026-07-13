import Link from 'next/link';

/** Ненавязчивый баннер с призывом войти для синхронизации прогресса. */
export default function LoginBanner() {
  return (
    <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-accent/20 bg-gradient-to-r from-accent/10 to-transparent p-5 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-base font-semibold text-white">
          Войдите, чтобы синхронизировать прогресс
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          Позиция просмотра сохранится в облаке и восстановится на любом
          устройстве.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href="/login"
          className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-bg-card"
        >
          Вход
        </Link>
        <Link
          href="/signup"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
        >
          Регистрация
        </Link>
      </div>
    </div>
  );
}

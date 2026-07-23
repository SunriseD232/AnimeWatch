interface Props {
  code: string | null;
}

/** Карточка кода регистрации — переиспользуется на /code и во вкладке профиля. */
export default function SignupCodeCard({ code }: Props) {
  return (
    <div className="w-full max-w-sm">
      <p className="mb-3 text-sm text-gray-400">
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

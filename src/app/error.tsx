'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
      <div className="text-5xl">😵</div>
      <h1 className="text-2xl font-bold">Что-то пошло не так</h1>
      <p className="text-sm text-gray-400">
        Произошла ошибка при загрузке страницы. Попробуйте ещё раз.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full press bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
      >
        Повторить
      </button>
    </div>
  );
}

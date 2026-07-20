import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
      <div className="text-5xl">🔍</div>
      <h1 className="text-2xl font-bold">Ничего не найдено</h1>
      <p className="text-sm text-gray-400">
        Тайтл не существует или временно недоступен в каталоге Shikimori.
      </p>
      <Link
        href="/"
        className="rounded-full press bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
      >
        На главную
      </Link>
    </div>
  );
}

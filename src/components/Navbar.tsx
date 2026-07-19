import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import SearchBox from './SearchBox';

export default async function Navbar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-bg/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-lg font-bold"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white">
            ▶
          </span>
          <span className="hidden sm:inline">MediaWatch</span>
        </Link>

        <div className="flex-1">
          <SearchBox />
        </div>

        {user ? (
          <Link
            href="/profile"
            className="shrink-0 rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-bg-card hover:text-white"
          >
            Профиль
          </Link>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-bg-card hover:text-white"
            >
              Вход
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
            >
              Регистрация
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}

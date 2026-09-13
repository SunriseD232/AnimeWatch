import Link from 'next/link';
import { IconBadge, SearchIcon } from '@/components/social/icons';

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
      <IconBadge>
        <SearchIcon className="h-7 w-7" />
      </IconBadge>
      <h1 className="text-2xl font-bold">Ничего не найдено</h1>
      <p className="text-sm text-gray-400">
        Тайтл не существует или временно недоступен в каталоге Shikimori.
      </p>
      <Link
        href="/"
        className="rounded-full press bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
      >
        На главную
      </Link>
    </div>
  );
}

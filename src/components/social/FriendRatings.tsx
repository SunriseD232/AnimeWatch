import Link from 'next/link';
import type { PublicUser } from '@/lib/social/types';
import Avatar from './Avatar';
import { StarIcon } from './icons';

const SHOWN = 8;

/** «Друзья оценили» на странице тайтла. Нет оценок друзей — нет и строки. */
export default function FriendRatings({ friends }: { friends: { user: PublicUser; score: number }[] }) {
  if (friends.length === 0) return null;
  const shown = friends.slice(0, SHOWN);
  const rest = friends.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-400">Друзья оценили:</span>
      <ul className="flex min-w-0 flex-wrap gap-2">
        {shown.map(({ user, score }) => (
          <li key={user.id} className="min-w-0">
            <Link
              href={`/u/${user.id}`}
              className="press relative flex min-w-0 items-center gap-1.5 rounded-full bg-bg-card py-1 pl-1 pr-2.5 ring-1 ring-white/5 transition hover:ring-accent/60"
            >
              <Avatar user={user} size="xs" />
              <span className="max-w-[9rem] truncate text-gray-200">{user.name}</span>
              <span className="inline-flex items-center gap-0.5 font-semibold tabular-nums text-gray-100">
                <StarIcon className="h-3 w-3 text-accent" filled />
                <span className="sr-only">оценка </span>
                {score}
              </span>
            </Link>
          </li>
        ))}
        {rest > 0 && <li className="self-center text-gray-400">и ещё {rest}</li>}
      </ul>
    </div>
  );
}

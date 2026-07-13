'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { UserListItem, UserListStatus } from '@/lib/types';

const FILTERS: { value: UserListStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'watching', label: 'Смотрю' },
  { value: 'planned', label: 'В планах' },
  { value: 'completed', label: 'Просмотрено' },
  { value: 'dropped', label: 'Брошено' },
];

const STATUS_LABELS: Record<UserListStatus, string> = {
  watching: 'Смотрю',
  planned: 'В планах',
  completed: 'Просмотрено',
  dropped: 'Брошено',
};

export default function UserListView({
  items,
}: {
  items: UserListItem[];
}) {
  const [filter, setFilter] = useState<UserListStatus | 'all'>('all');

  const visible =
    filter === 'all'
      ? items
      : items.filter((i) => i.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.value === 'all'
              ? items.length
              : items.filter((i) => i.status === f.value).length;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                filter === f.value
                  ? 'bg-accent text-white'
                  : 'bg-bg-card text-gray-300 hover:bg-bg-soft',
              ].join(' ')}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-400">Здесь пока пусто.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {visible.map((item) => (
            <Link
              key={item.id}
              href={`/anime/${item.shikimori_id}`}
              className="group flex flex-col overflow-hidden rounded-xl bg-bg-card ring-1 ring-white/5 transition hover:ring-accent/60"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
                {item.poster_url ? (
                  <Image
                    src={item.poster_url}
                    alt={item.anime_title}
                    fill
                    sizes="(max-width: 640px) 45vw, 200px"
                    className="object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-gray-600">
                    нет постера
                  </div>
                )}
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {STATUS_LABELS[item.status]}
                </span>
              </div>
              <div className="p-2.5">
                <h3 className="line-clamp-2 text-sm font-medium leading-snug">
                  {item.anime_title}
                </h3>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

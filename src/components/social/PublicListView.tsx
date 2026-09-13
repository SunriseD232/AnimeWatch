'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import PosterImage from '@/components/PosterImage';
import { fixPosterUrl } from '@/lib/format';
import { LIST_STATUS_OPTIONS } from '@/lib/listStatus';
import type { VisibleListItem } from '@/lib/social/server';
import type { UserListStatus } from '@/lib/types';
import { ListPlusIcon } from './icons';

/**
 * Чужой список на странице человека: только просмотр, вкладками по статусам.
 * Пустые статусы не показываются — вкладка «Брошено · 0» у чужого человека
 * ничего не сообщает.
 */
export default function PublicListView({
  items,
  localPosters,
}: {
  items: VisibleListItem[];
  localPosters: Record<string, string>;
}) {
  const counts = useMemo(() => {
    const map = new Map<UserListStatus, number>();
    for (const item of items) map.set(item.status, (map.get(item.status) ?? 0) + 1);
    return map;
  }, [items]);
  const statuses = LIST_STATUS_OPTIONS.filter((o) => (counts.get(o.value) ?? 0) > 0);
  const [status, setStatus] = useState<UserListStatus | null>(statuses[0]?.value ?? null);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-bg-card px-5 py-6 text-sm text-gray-300 ring-1 ring-white/5">
        <ListPlusIcon className="h-5 w-5 text-accent" />
        <span>Список пока пуст.</span>
      </div>
    );
  }

  const shown = items.filter((i) => i.status === status);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Статус" className="flex flex-wrap gap-2">
        {statuses.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setStatus(o.value)}
            aria-pressed={status === o.value}
            className={[
              'press inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition',
              status === o.value ? 'bg-accent text-accent-fg' : 'bg-bg-card text-gray-300 ring-1 ring-white/5 hover:bg-bg-soft',
            ].join(' ')}
          >
            {o.label}
            <span className={status === o.value ? 'opacity-80' : 'text-gray-400'}>{counts.get(o.value)}</span>
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {shown.map((item) => {
          const kind = item.contentType === 'cinema' ? 'cinema' : 'anime';
          const key = `${kind}:${item.shikimoriId}`;
          return (
            <li key={key}>
              <Link
                href={`/${kind}/${item.shikimoriId}`}
                className="card-lift group flex flex-col overflow-hidden rounded-xl bg-bg-card ring-1 ring-white/5 hover:ring-accent/60"
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
                  <PosterImage
                    sources={[localPosters[key], fixPosterUrl(item.posterUrl)]}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    placeholderClassName="grid h-full w-full place-items-center text-xs text-gray-400"
                  />
                </div>
                <span className="line-clamp-2 p-2 text-xs font-medium text-gray-100">{item.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

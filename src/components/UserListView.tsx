'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type {
  ContentType,
  UserListItem,
  UserListStatus,
} from '@/lib/types';
import { fixPosterUrl } from '@/lib/format';
import ExpandTitleButton from '@/components/ExpandTitleButton';

const TYPE_TABS: { value: ContentType; label: string }[] = [
  { value: 'anime', label: 'Аниме' },
  { value: 'cinema', label: 'Фильмы и сериалы' },
];

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

/** Карточка тайтла в списке — своё состояние раскрытия названия на каждую. */
function ListCard({ item }: { item: UserListItem }) {
  const [expanded, setExpanded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (
    <div className="card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-white/5 hover:ring-accent/60">
      <Link
        href={`/${item.content_type === 'cinema' ? 'cinema' : 'anime'}/${item.shikimori_id}`}
        className="flex flex-1 flex-col"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-bg-soft">
          {item.poster_url ? (
            // <img> + no-referrer: хотлинк-защита Shikimori/Кинопоиска
            // (next/image через серверный прокси терял картинки).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fixPosterUrl(item.poster_url)!}
              alt={item.anime_title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
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
          <h3
            ref={titleRef}
            className={[
              'text-sm font-medium leading-snug',
              expanded ? '' : 'line-clamp-2',
            ].join(' ')}
          >
            {item.anime_title}
          </h3>
        </div>
      </Link>
      <ExpandTitleButton
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        titleRef={titleRef}
      />
    </div>
  );
}

export default function UserListView({
  items,
}: {
  items: UserListItem[];
}) {
  const [type, setType] = useState<ContentType>('anime');
  const [filter, setFilter] = useState<UserListStatus | 'all'>('all');

  // Аниме и кино — раздельные вкладки, чтобы списки не перемешивались.
  const ofType = items.filter((i) => i.content_type === type);
  const visible =
    filter === 'all' ? ofType : ofType.filter((i) => i.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {TYPE_TABS.map((t) => {
          const count = items.filter(
            (i) => i.content_type === t.value,
          ).length;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={[
                'rounded-lg px-4 py-2 text-sm font-semibold transition',
                type === t.value
                  ? 'bg-accent text-white'
                  : 'bg-bg-card text-gray-300 hover:bg-bg-soft',
              ].join(' ')}
            >
              {t.label}
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.value === 'all'
              ? ofType.length
              : ofType.filter((i) => i.status === f.value).length;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                filter === f.value
                  ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
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
            <ListCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

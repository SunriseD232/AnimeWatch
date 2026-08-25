'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
  ContentType,
  UserListItem,
  UserListStatus,
} from '@/lib/types';
import { fixPosterUrl } from '@/lib/format';
import ExpandTitleButton from '@/components/ExpandTitleButton';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ToastProvider';

const TYPE_TABS: { value: ContentType; label: string }[] = [
  { value: 'anime', label: 'Аниме' },
  { value: 'cinema', label: 'Фильмы и сериалы' },
];

const STATUS_OPTIONS: { value: UserListStatus; label: string }[] = [
  { value: 'watching', label: 'Смотрю' },
  { value: 'planned', label: 'В планах' },
  { value: 'completed', label: 'Просмотрено' },
  { value: 'dropped', label: 'Брошено' },
];

const FILTERS: { value: UserListStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  ...STATUS_OPTIONS,
];

const STATUS_LABELS: Record<UserListStatus, string> = {
  watching: 'Смотрю',
  planned: 'В планах',
  completed: 'Просмотрено',
  dropped: 'Брошено',
};

/** Карточка тайтла в списке — своё состояние раскрытия названия на каждую. */
function ListCard({
  item,
  selectMode,
  selected,
  onToggleSelect,
}: {
  item: UserListItem;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const body = (
    <>
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
          <div className="grid h-full w-full place-items-center text-gray-400">
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
    </>
  );

  return (
    <div
      className={[
        'card-lift group relative flex flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 hover:ring-accent/60',
        selectMode && selected ? 'ring-2 ring-accent' : 'ring-white/5',
      ].join(' ')}
    >
      {selectMode ? (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          aria-label={selected ? 'Убрать выделение' : 'Выделить'}
          className="flex flex-1 flex-col text-left"
        >
          {body}
        </button>
      ) : (
        <Link
          href={`/${item.content_type === 'cinema' ? 'cinema' : 'anime'}/${item.shikimori_id}`}
          className="flex flex-1 flex-col"
        >
          {body}
        </Link>
      )}
      {selectMode && (
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition',
            selected
              ? 'border-accent bg-accent text-white'
              : 'border-white/40 bg-black/50',
          ].join(' ')}
        >
          {selected && (
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3 fill-none stroke-white stroke-[2.5]"
            >
              <path
                d="M3.5 8.5 6.5 11.5 12.5 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      )}
      {!selectMode && (
        <ExpandTitleButton
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          titleRef={titleRef}
        />
      )}
    </div>
  );
}

export default function UserListView({
  items,
  readOnly = false,
}: {
  items: UserListItem[];
  /** Просмотр чужого списка админом (см. /admin/users/[id]) — без выбора/массовых действий. */
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<ContentType>('anime');
  const [filter, setFilter] = useState<UserListStatus | 'all'>('all');
  const [localItems, setLocalItems] = useState(items);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => setLocalItems(items), [items]);

  // Аниме и кино — раздельные вкладки, чтобы списки не перемешивались.
  const ofType = localItems.filter((i) => i.content_type === type);
  const visible =
    filter === 'all' ? ofType : ofType.filter((i) => i.status === filter);

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkSetStatus(status: UserListStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from('user_list')
        .update({ status })
        .in('id', ids);
      if (error) throw error;
      setLocalItems((prev) =>
        prev.map((i) => (ids.includes(i.id) ? { ...i, status } : i)),
      );
      toast(`Статус обновлён для ${ids.length}`, 'success');
      setSelectMode(false);
      setSelected(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      toast(msg, 'error');
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkRemove() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.from('user_list').delete().in('id', ids);
      if (error) throw error;
      setLocalItems((prev) => prev.filter((i) => !ids.includes(i.id)));
      toast(`Удалено: ${ids.length}`, 'success');
      setSelectMode(false);
      setSelected(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      toast(msg, 'error');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Раздел (аниме/кино) — трек-переключатель, тот же паттерн, что и
          ModeSwitch на главной. Визуально отличается от ряда фильтров
          статуса ниже — раньше оба ряда были одинаковыми плоскими пилюлями,
          и было сложно с ходу понять, что это два разных уровня. */}
      <div className="inline-flex w-fit rounded-full border border-white/10 bg-bg-card p-1">
        {TYPE_TABS.map((t) => {
          const count = localItems.filter(
            (i) => i.content_type === t.value,
          ).length;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={[
                'press rounded-full px-4 py-2 text-sm font-medium transition',
                type === t.value
                  ? 'bg-accent text-white'
                  : 'text-gray-300 hover:bg-bg-soft hover:text-white',
              ].join(' ')}
            >
              {t.label}
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
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
                  'press rounded-lg px-3 py-1.5 text-sm font-medium transition',
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
        {visible.length > 0 && !readOnly && (
          <button
            type="button"
            onClick={toggleSelectMode}
            className={[
              'press rounded-lg px-3 py-1.5 text-sm font-medium transition',
              selectMode
                ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
                : 'bg-bg-card text-gray-300 hover:bg-bg-soft',
            ].join(' ')}
          >
            {selectMode ? 'Отмена' : 'Выбрать'}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-bg-card/95 p-2.5 backdrop-blur">
          <span className="px-1 text-sm text-gray-300">
            Выбрано: {selected.size}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => bulkSetStatus(o.value)}
                className="press rounded-lg bg-bg-soft px-3 py-1.5 text-sm text-gray-200 transition hover:bg-white/10 disabled:opacity-40"
              >
                {o.label}
              </button>
            ))}
            <button
              type="button"
              disabled={selected.size === 0 || bulkBusy}
              onClick={bulkRemove}
              className="press rounded-lg bg-red-950/60 px-3 py-1.5 text-sm text-red-200 transition hover:bg-red-900/60 disabled:opacity-40"
            >
              Убрать
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-bg-card px-6 py-10 text-center">
          <span className="text-3xl" aria-hidden="true">
            🗂️
          </span>
          <p className="text-sm text-gray-400">Здесь пока пусто.</p>
          <Link
            href={type === 'cinema' ? '/cinema/catalog' : '/catalog'}
            className="press rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
          >
            Найти что посмотреть →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {visible.map((item) => (
            <ListCard
              key={item.id}
              item={item}
              selectMode={selectMode}
              selected={selected.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

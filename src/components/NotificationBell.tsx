'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { EpisodeNotification } from '@/lib/types';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

/**
 * Колокольчик уведомлений о новых сериях (тайтлы в статусе «Смотрю»).
 * Начальный список приходит с сервера (Navbar), дальше — Realtime-подписка
 * на INSERT в episode_notifications, чтобы новые уведомления прилетали без
 * перезагрузки страницы (тот же приём, что и синхронизация прогресса в
 * Player.tsx/WatchPlayer.tsx).
 */
export default function NotificationBell({
  initial,
}: {
  initial: EpisodeNotification[];
}) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.read_at).length;

  // Закрытие дропдауна по клику вовне.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notif-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'episode_notifications' },
        (payload) => {
          setItems((prev) => [
            payload.new as EpisodeNotification,
            ...prev,
          ]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function markRead(id: string) {
    if (items.find((n) => n.id === id)?.read_at) return;
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)),
    );
    const supabase = createClient();
    await supabase
      .from('episode_notifications')
      .update({ read_at: now })
      .eq('id', id);
  }

  async function markAllRead() {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    const supabase = createClient();
    await supabase
      .from('episode_notifications')
      .update({ read_at: now })
      .in('id', ids);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
        className="press relative grid h-9 w-9 place-items-center rounded-full text-gray-300 hover:bg-white/5 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M12 3a5 5 0 0 0-5 5v3.2c0 .5-.16 1-.46 1.4L5 15h14l-1.54-2.4c-.3-.4-.46-.9-.46-1.4V8a5 5 0 0 0-5-5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 18a2.5 2.5 0 0 0 5 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="glass absolute right-0 z-30 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-semibold">Уведомления</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-accent hover:text-accent-hover"
              >
                Прочитать всё
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                Пока нет уведомлений
              </p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={`/${n.content_type === 'cinema' ? 'cinema' : 'anime'}/${n.shikimori_id}`}
                  onClick={() => {
                    setOpen(false);
                    markRead(n.id);
                  }}
                  className={[
                    'flex gap-3 border-b border-white/5 px-4 py-3 transition last:border-b-0 hover:bg-white/5',
                    n.read_at ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
                    {n.poster_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={n.poster_url}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-gray-100">
                      {n.title}
                    </p>
                    <p className="text-xs text-gray-400">
                      Новая серия — теперь их {n.episode}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                  {!n.read_at && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  )}
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

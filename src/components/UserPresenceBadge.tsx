'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AdminUserEntry, PresenceSummary } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';

/**
 * Бейдж «N онлайн» в шапке (только у админов, см. Navbar.tsx) — сам счётчик
 * приходит с сервера дешёвым запросом (getOnlineUserCount, без почт). Список
 * (почты + время последнего захода) тянется ЛЕНИВО, только по клику, через
 * /api/admin/presence — раньше это тянулось при КАЖДОМ рендере шапки
 * (admin.listUsers) и заметно тормозило весь сайт, см. коммит с фиксом.
 *
 * Каждая строка ведёт на /admin/users/[id] — только просмотр списка
 * пользователя (что запланировал, что смотрит), без возможности что-либо
 * изменить, см. readOnly в UserListView.
 */
export default function UserPresenceBadge({ onlineCount }: { onlineCount: number }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<PresenceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !summary && !loading) {
      setLoading(true);
      fetch('/api/admin/presence')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: PresenceSummary | null) => setSummary(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  };

  const users = summary?.users ?? [];
  const onlineUsers = users.filter((u) => u.online);
  const restUsers = users.filter((u) => !u.online);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="press flex items-center gap-1.5 rounded-full bg-bg-card px-3 py-1.5 text-xs font-medium text-gray-400 ring-1 ring-white/10 transition hover:text-white"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {onlineCount} онлайн
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-white/10 bg-bg-card shadow-2xl">
          {loading && !summary ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">Загрузка…</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <div className="border-b border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Онлайн ({onlineUsers.length})
              </div>
              {onlineUsers.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">Никого нет</p>
              ) : (
                onlineUsers.map((u) => (
                  <UserRow key={u.id} entry={u} onNavigate={() => setOpen(false)} />
                ))
              )}

              <div className="border-b border-t border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Остальные ({restUsers.length})
              </div>
              {restUsers.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">Никого нет</p>
              ) : (
                restUsers.map((u) => (
                  <UserRow key={u.id} entry={u} onNavigate={() => setOpen(false)} />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UserRow({ entry, onNavigate }: { entry: AdminUserEntry; onNavigate: () => void }) {
  return (
    <Link
      href={`/admin/users/${entry.id}`}
      onClick={onNavigate}
      className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-2 text-sm text-gray-100 transition last:border-b-0 hover:bg-white/5"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={[
            'h-1.5 w-1.5 shrink-0 rounded-full',
            entry.online ? 'bg-emerald-400' : 'bg-gray-600',
          ].join(' ')}
        />
        <span className="truncate">{entry.email}</span>
      </span>
      <span className="shrink-0 text-xs text-gray-500">
        {entry.online ? 'сейчас' : entry.lastSeenAt ? formatDateTime(entry.lastSeenAt) : 'не заходил'}
      </span>
    </Link>
  );
}

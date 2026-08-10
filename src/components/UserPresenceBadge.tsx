'use client';

import { useEffect, useRef, useState } from 'react';
import type { PresenceSummary } from '@/lib/admin';

/**
 * Бейдж «N онлайн» в шапке (только у админов, см. Navbar.tsx) — сам счётчик
 * приходит с сервера дешёвым запросом (getOnlineUserCount, без почт). Почты
 * (и точный «всего») тянутся ЛЕНИВО, только по клику, через
 * /api/admin/presence — раньше это тянулось при КАЖДОМ рендере шапки
 * (admin.listUsers) и заметно тормозило весь сайт, см. коммит с фиксом.
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

  const onlineEmails = summary?.onlineEmails ?? [];
  const onlineSet = new Set(onlineEmails);
  const restEmails = (summary?.totalEmails ?? []).filter((e) => !onlineSet.has(e));

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
        <div className="absolute right-0 z-30 mt-2 w-72 max-w-[90vw] overflow-hidden rounded-2xl border border-white/10 bg-bg-card shadow-2xl">
          {loading && !summary ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">Загрузка…</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <div className="border-b border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Онлайн ({onlineEmails.length})
              </div>
              {onlineEmails.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">Никого нет</p>
              ) : (
                onlineEmails.map((email) => (
                  <div
                    key={email}
                    className="flex items-center gap-2 border-b border-white/5 px-4 py-2 text-sm text-gray-100 last:border-b-0"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="truncate">{email}</span>
                  </div>
                ))
              )}

              <div className="border-b border-t border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Остальные ({restEmails.length})
              </div>
              {restEmails.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">Никого нет</p>
              ) : (
                restEmails.map((email) => (
                  <div
                    key={email}
                    className="truncate border-b border-white/5 px-4 py-2 text-sm text-gray-300 last:border-b-0"
                  >
                    {email}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

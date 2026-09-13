'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { FriendEntry, FriendshipState, PublicUser } from '@/lib/social/types';
import Avatar from './Avatar';
import FriendButton from './FriendButton';
import { SearchIcon, UsersIcon } from './icons';

/**
 * Вкладка «Друзья» в профиле: поиск по имени, входящие заявки, друзья,
 * отправленные заявки.
 *
 * Входящие стоят ПЕРВЫМИ после поиска: это единственное, что ждёт действия
 * человека, и ради них он чаще всего сюда и заходит (на иконку профиля
 * вешается точка, пока заявки есть).
 */

interface SearchResult {
  user: PublicUser;
  state: FriendshipState;
}

export default function FriendsPanel({ initial }: { initial: FriendEntry[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState(initial);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchId = useId();
  const requestRef = useRef(0);

  useEffect(() => setEntries(initial), [initial]);

  // Поиск с задержкой: запрос на каждую букву — лишняя нагрузка и мигание
  // списка, пока человек ещё печатает.
  useEffect(() => {
    const q = query.trim();
    if ([...q].length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const seq = ++requestRef.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: SearchResult[] };
        if (seq !== requestRef.current) return;
        setResults(data.results);
        setSearchError(false);
      } catch {
        if (seq !== requestRef.current) return;
        setSearchError(true);
      } finally {
        if (seq === requestRef.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function applyState(user: PublicUser, next: FriendshipState) {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.user.id !== user.id);
      if (next === 'none' || next === 'self') return rest;
      return [{ user, state: next }, ...rest];
    });
    setResults((prev) => prev?.map((r) => (r.user.id === user.id ? { ...r, state: next } : r)) ?? prev);
    // Точка «есть заявки» на иконке профиля рисуется сервером в шапке.
    router.refresh();
  }

  const incoming = entries.filter((e) => e.state === 'incoming');
  const friends = entries.filter((e) => e.state === 'friends');
  const outgoing = entries.filter((e) => e.state === 'outgoing');

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <label htmlFor={searchId} className="text-sm font-medium text-gray-200">
          Найти по имени
        </label>
        <div className="relative max-w-md">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя, которое человек задал в профиле"
            autoComplete="off"
            className="w-full rounded-full border border-white/10 bg-bg-soft py-2.5 pl-9 pr-4 text-sm text-gray-100 placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div aria-live="polite" className="flex flex-col gap-2">
          {searching && <p className="text-sm text-gray-400">Ищем…</p>}
          {!searching && searchError && (
            <p className="text-sm text-red-300">Поиск не ответил. Попробуйте ещё раз через минуту.</p>
          )}
          {!searching && !searchError && results && results.length === 0 && (
            <p className="text-sm text-gray-400">
              Никого с таким именем. Если человек имя не задавал, откройте его профиль по имени под комментарием.
            </p>
          )}
          {!searching && results && results.length > 0 && (
            <ul className="flex flex-col gap-2">
              {results.map((r) => (
                <PersonRow key={r.user.id} user={r.user}>
                  <FriendButton
                    userId={r.user.id}
                    name={r.user.name}
                    initialState={r.state}
                    onStateChange={(next) => applyState(r.user, next)}
                  />
                </PersonRow>
              ))}
            </ul>
          )}
        </div>
      </section>

      {incoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-gray-100">
            Заявки в друзья <span className="text-accent">· {incoming.length}</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((e) => (
              <PersonRow key={e.user.id} user={e.user} highlight>
                <FriendButton
                  userId={e.user.id}
                  name={e.user.name}
                  initialState="incoming"
                  onStateChange={(next) => applyState(e.user, next)}
                />
              </PersonRow>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-gray-100">
          Друзья {friends.length > 0 && <span className="text-gray-400">· {friends.length}</span>}
        </h2>
        {friends.length === 0 ? (
          <div className="flex items-start gap-3 rounded-2xl bg-bg-card px-5 py-6 text-sm text-gray-300 ring-1 ring-white/5">
            <UsersIcon className="mt-0.5 h-5 w-5 text-accent" />
            <div className="flex flex-col gap-1">
              <p className="font-medium text-gray-100">Друзей пока нет</p>
              <p>
                С друзьями видно, что они оценили и как. Найдите человека по имени выше или нажмите на имя под
                комментарием к серии.
              </p>
            </div>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {friends.map((e) => (
              <PersonRow key={e.user.id} user={e.user} />
            ))}
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-gray-100">Отправленные заявки</h2>
          <ul className="flex flex-col gap-2">
            {outgoing.map((e) => (
              <PersonRow key={e.user.id} user={e.user}>
                <FriendButton
                  userId={e.user.id}
                  name={e.user.name}
                  initialState="outgoing"
                  onStateChange={(next) => applyState(e.user, next)}
                />
              </PersonRow>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PersonRow({
  user,
  children,
  highlight = false,
}: {
  user: PublicUser;
  children?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <li
      className={[
        'flex flex-wrap items-center gap-3 rounded-xl p-2.5 ring-1',
        highlight ? 'bg-accent/10 ring-accent/30' : 'bg-bg-card ring-white/5',
      ].join(' ')}
    >
      <Link href={`/u/${user.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <Avatar user={user} size="md" />
        <span className="min-w-0 truncate text-sm font-medium text-gray-100 underline-offset-2 transition group-hover:text-white group-hover:underline">
          {user.name}
        </span>
      </Link>
      {children}
    </li>
  );
}

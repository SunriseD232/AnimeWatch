'use client';

import { useState } from 'react';
import UserListView from '@/components/UserListView';
import HistoryView from '@/components/HistoryView';
import ContinueCard from '@/components/ContinueCard';
import type { UserListItem, WatchedEpisode, WatchProgress } from '@/lib/types';

interface Props {
  items: UserListItem[];
  history: WatchedEpisode[];
  /** «Продолжить просмотр» целевого пользователя — только у админа (см.
   *  app/admin/users/[id]/page.tsx), в собственном профиле такой вкладки нет
   *  вовсе (см. ProfileTabs.tsx). */
  continueWatching: { progress: WatchProgress; isMultiSeason: boolean }[];
}

type Tab = 'list' | 'history' | 'continue';

/**
 * Вкладки на странице чужого профиля глазами админа (см.
 * app/admin/users/[id]/page.tsx) — «Список», «История» и «Продолжить
 * просмотр», тот же паттерн, что ProfileTabs.tsx в собственном профиле (но
 * без вкладки «Продолжить просмотр» там — это чисто админский, диагностический
 * взгляд на чужие данные, не общая функция профиля). Все три вида — read-only
 * (см. readOnly у UserListView/ContinueCard и то, что HistoryView и так
 * ничего не мутирует).
 */
export default function AdminUserTabs({ items, history, continueWatching }: Props) {
  const [tab, setTab] = useState<Tab>('list');

  const tabs: { value: Tab; label: string }[] = [
    { value: 'list', label: 'Список' },
    { value: 'history', label: 'История' },
    { value: 'continue', label: 'Продолжить просмотр' },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={[
              'rounded-lg px-4 py-2 text-sm font-semibold transition',
              tab === t.value
                ? 'bg-accent text-white'
                : 'bg-bg-card text-gray-300 hover:bg-bg-soft',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'list' && <UserListView items={items} readOnly />}
      {tab === 'history' && <HistoryView items={history} />}
      {tab === 'continue' &&
        (continueWatching.length === 0 ? (
          <p className="text-sm text-gray-400">Пользователь ничего не смотрит.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {continueWatching.map(({ progress, isMultiSeason }) => (
              <ContinueCard
                key={progress.id}
                progress={progress}
                isMultiSeason={isMultiSeason}
                readOnly
              />
            ))}
          </div>
        ))}
    </section>
  );
}

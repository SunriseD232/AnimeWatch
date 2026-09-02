'use client';

import { useState } from 'react';
import UserListView from '@/components/UserListView';
import HistoryView from '@/components/HistoryView';
import type { UserListItem, WatchedEpisode } from '@/lib/types';

interface Props {
  items: UserListItem[];
  history: WatchedEpisode[];
}

type Tab = 'list' | 'history';

/**
 * Вкладки на странице чужого профиля глазами админа (см.
 * app/admin/users/[id]/page.tsx) — «Список» и «История», тот же паттерн, что
 * ProfileTabs.tsx в собственном профиле. Раньше здесь был только список по
 * тегам (UserListView) — историю просмотра можно было увидеть только у себя,
 * что мешало админу разобраться в жалобе вида «у меня ничего не сохраняется».
 * Оба вида — read-only (см. readOnly у UserListView и то, что HistoryView и
 * так ничего не мутирует).
 */
export default function AdminUserTabs({ items, history }: Props) {
  const [tab, setTab] = useState<Tab>('list');

  const tabs: { value: Tab; label: string }[] = [
    { value: 'list', label: 'Список' },
    { value: 'history', label: 'История' },
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
    </section>
  );
}

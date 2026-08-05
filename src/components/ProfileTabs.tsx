'use client';

import { useState } from 'react';
import SignupCodeCard from '@/components/SignupCodeCard';
import UserListView from '@/components/UserListView';
import HistoryView from '@/components/HistoryView';
import type { UserListItem, WatchedEpisode } from '@/lib/types';

interface Props {
  items: UserListItem[];
  history: WatchedEpisode[];
  /** Показывать вкладку «Код» — только для админов (см. lib/admin.ts). */
  showCodeTab: boolean;
  code: string | null;
}

type Tab = 'list' | 'history' | 'code';

/**
 * Вкладки профиля: «Список» и «История» — всегда, «Код» — только для
 * админов, чтобы не ходить отдельно на /code (см. src/app/code/page.tsx —
 * та же карточка). Переключение чисто клиентское — данные всех вкладок уже
 * переданы с сервера, повторный fetch не нужен.
 */
export default function ProfileTabs({
  items,
  history,
  showCodeTab,
  code,
}: Props) {
  const [tab, setTab] = useState<Tab>('list');

  const tabs: { value: Tab; label: string }[] = [
    { value: 'list', label: 'Список' },
    { value: 'history', label: 'История' },
    ...(showCodeTab ? [{ value: 'code' as Tab, label: 'Код' }] : []),
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-2">
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

      {tab === 'list' && <UserListView items={items} />}
      {tab === 'history' && <HistoryView items={history} />}
      {tab === 'code' && <SignupCodeCard code={code} />}
    </section>
  );
}

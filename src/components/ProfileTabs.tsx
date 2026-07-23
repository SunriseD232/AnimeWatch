'use client';

import { useState } from 'react';
import SignupCodeCard from '@/components/SignupCodeCard';
import UserListView from '@/components/UserListView';
import type { UserListItem } from '@/lib/types';

interface Props {
  items: UserListItem[];
  /** Показывать вкладку «Код» — только для админов (см. lib/admin.ts). */
  showCodeTab: boolean;
  code: string | null;
}

/**
 * Вкладки профиля: «Список» — всегда, «Код» — только для админов, чтобы не
 * ходить отдельно на /code (см. src/app/code/page.tsx — та же карточка).
 * Переключение чисто клиентское — данные обеих вкладок уже переданы с
 * сервера, повторный fetch не нужен.
 */
export default function ProfileTabs({ items, showCodeTab, code }: Props) {
  const [tab, setTab] = useState<'list' | 'code'>('list');

  if (!showCodeTab) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Мой список</h2>
        <UserListView items={items} />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('list')}
          className={[
            'rounded-lg px-4 py-2 text-sm font-semibold transition',
            tab === 'list'
              ? 'bg-accent text-white'
              : 'bg-bg-card text-gray-300 hover:bg-bg-soft',
          ].join(' ')}
        >
          Список
        </button>
        <button
          type="button"
          onClick={() => setTab('code')}
          className={[
            'rounded-lg px-4 py-2 text-sm font-semibold transition',
            tab === 'code'
              ? 'bg-accent text-white'
              : 'bg-bg-card text-gray-300 hover:bg-bg-soft',
          ].join(' ')}
        >
          Код
        </button>
      </div>

      {tab === 'list' ? (
        <UserListView items={items} />
      ) : (
        <SignupCodeCard code={code} />
      )}
    </section>
  );
}

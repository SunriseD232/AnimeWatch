'use client';

import Link from 'next/link';
import { useState } from 'react';
import SignupCodeCard from '@/components/SignupCodeCard';
import UserListView from '@/components/UserListView';
import HistoryView from '@/components/HistoryView';
import ThemeSettings from '@/components/ThemeSettings';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import VibixTrialStatus from '@/components/VibixTrialStatus';
import RelayToggle from '@/components/RelayToggle';
import KodikPlayerToggle from '@/components/KodikPlayerToggle';
import type { UserListItem, WatchedEpisode } from '@/lib/types';
import type { Theme } from '@/lib/theme';

interface Props {
  items: UserListItem[];
  history: WatchedEpisode[];
  /** Готовые ссылки на наши копии обложек — см. getLocalPosterMap. */
  localPosters: Record<string, string>;
  /** Тема из БД, прочитанная на сервере (см. ThemeSettings). */
  initialTheme: Theme;
  isAdmin: boolean;
  /** Живые рубильники — только имеют смысл при isAdmin, см. profile/page.tsx. */
  relayEnabled: boolean;
  kodikPlayerEnabled: boolean;
  code: string | null;
}

type Tab = 'list' | 'history' | 'ui' | 'password' | 'admin' | 'code';

/**
 * Вкладки профиля. Раньше «Оформление», рубильники и смена пароля были
 * отдельными карточками прямо на странице, вперемешку со списком/историей —
 * при добавлении Kodik-флага и настроек темы страница превратилась в
 * сплошную простыню. Теперь всё разложено по вкладкам: «Список»/«История» —
 * всегда, «UI»/«Пароль» — всегда (личные настройки, не завязаны на роль),
 * «Администратор»/«Код» — только для админов (см. lib/admin.ts).
 * Переключение чисто клиентское — данные всех вкладок уже переданы с сервера,
 * повторный fetch не нужен.
 */
export default function ProfileTabs({
  items,
  history,
  localPosters,
  initialTheme,
  isAdmin,
  relayEnabled,
  kodikPlayerEnabled,
  code,
}: Props) {
  const [tab, setTab] = useState<Tab>('list');

  const tabs: { value: Tab; label: string }[] = [
    { value: 'list', label: 'Список' },
    { value: 'history', label: 'История' },
    { value: 'ui', label: 'UI' },
    { value: 'password', label: 'Пароль' },
    ...(isAdmin
      ? [
          { value: 'admin' as Tab, label: 'Администратор' },
          { value: 'code' as Tab, label: 'Код' },
        ]
      : []),
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
                ? 'bg-accent text-accent-fg'
                : 'bg-bg-card text-gray-300 hover:bg-bg-soft',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'list' && <UserListView items={items} localPosters={localPosters} />}
      {tab === 'history' && <HistoryView items={history} localPosters={localPosters} />}
      {tab === 'ui' && <ThemeSettings initialTheme={initialTheme} />}
      {tab === 'password' && <ChangePasswordForm />}
      {tab === 'admin' && isAdmin && (
        <div className="flex flex-col gap-4">
          {/* Ссылка на страницу состояния — единственный вход в неё: сама
              страница закрыта notFound()'ом для не-админов, и светить её в
              общей навигации незачем. */}
          <Link
            href="/admin/status"
            className="press flex items-center justify-between gap-3 rounded-2xl bg-bg-card p-4 ring-1 ring-white/5 transition hover:ring-accent/60"
          >
            <span>
              <span className="block text-sm font-semibold text-gray-100">Состояние</span>
              <span className="block text-xs text-gray-400">
                Индексы каталогов, рейтинги, кэш обложек — когда обновлялись и чем закончилось
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-accent">
              →
            </span>
          </Link>
          <VibixTrialStatus />
          <RelayToggle initialEnabled={relayEnabled} />
          <KodikPlayerToggle initialEnabled={kodikPlayerEnabled} />
        </div>
      )}
      {tab === 'code' && isAdmin && <SignupCodeCard code={code} />}
    </section>
  );
}

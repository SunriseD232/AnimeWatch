import Link from 'next/link';
import type { ContentType } from '@/lib/types';

const TABS: { value: ContentType; label: string; href: string }[] = [
  { value: 'anime', label: 'Аниме', href: '/' },
  { value: 'cinema', label: 'Фильмы и сериалы', href: '/cinema' },
];

/**
 * Переключатель разделов вверху главной: «Аниме» ↔ «Фильмы и сериалы».
 * Сегментированный контрол на ссылках (route-based), активный подсвечен.
 */
export default function ModeSwitch({ active }: { active: ContentType }) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-bg-card p-1">
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'rounded-lg px-4 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-accent text-white'
                : 'text-gray-300 hover:bg-bg-soft hover:text-white',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

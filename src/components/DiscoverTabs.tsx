import Link from 'next/link';

interface Tab {
  key: string;
  label: string;
  href: string;
}

interface Props {
  tabs: Tab[];
  activeKey: string;
  catalogHref: string;
}

/**
 * Переключатель вкладок под «Продолжить просмотр» на главной (аниме/кино) —
 * Новинки/Популярное сменяют карусель ниже (см. DiscoverCarousel). Каталог —
 * отдельная ссылка, а не вкладка: это форма поиска по фильтрам, а не список
 * для карусели.
 */
export default function DiscoverTabs({ tabs, activeKey, catalogHref }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={[
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              tab.key === activeKey
                ? 'bg-accent text-white'
                : 'bg-bg-card text-gray-300 ring-1 ring-white/10 hover:bg-bg-soft',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <Link
        href={catalogHref}
        className="text-sm font-medium text-gray-400 transition hover:text-accent"
      >
        Каталог →
      </Link>
    </div>
  );
}

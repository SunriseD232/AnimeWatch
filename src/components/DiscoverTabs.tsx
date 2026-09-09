import Link from 'next/link';
import AnonsCheckbox from '@/components/AnonsCheckbox';

interface Tab {
  key: string;
  label: string;
  href: string;
}

interface Props {
  tabs: Tab[];
  activeKey: string;
  catalogHref: string;
  /** Показать чекбокс "Показывать анонсы" — сейчас только у аниме, у кино
   *  такого статуса тайтла нет (см. lib/videoseed-catalog.ts). */
  anonsToggle?: boolean;
  /** Текущее состояние чекбокса — примешивается к href вкладок, иначе
   *  переключение Новинки/Популярное молча сбрасывало бы ?anons=1. */
  showAnons?: boolean;
}

/**
 * Переключатель вкладок под «Продолжить просмотр» на главной (аниме/кино) —
 * Новинки/Популярное сменяют карусель ниже (см. DiscoverCarousel). Каталог —
 * отдельная ссылка, а не вкладка: это форма поиска по фильтрам, а не список
 * для карусели.
 */
export default function DiscoverTabs({
  tabs,
  activeKey,
  catalogHref,
  anonsToggle,
  showAnons,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={showAnons ? `${tab.href}&anons=1` : tab.href}
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
        {anonsToggle && <AnonsCheckbox />}
      </div>
      {/* Не серая текстовая ссылка, а кнопка в акцентном цвете: каталог —
          главный способ что-то найти на сайте, а выглядел он подписью под
          вкладками и терялся. Цвет берётся из темы пользователя (--accent),
          так что кнопка совпадает с выбранной палитрой, а не спорит с ней.
          Заливка полупрозрачная, а не сплошная: сплошной акцент рядом с
          активной вкладкой (она тоже bg-accent) читался бы как вторая
          выбранная вкладка. */}
      <Link
        href={catalogHref}
        className="press group flex items-center gap-2 rounded-full bg-accent/15 px-4 py-1.5 text-sm font-semibold text-accent ring-1 ring-accent/30 transition hover:bg-accent hover:text-white hover:ring-accent"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0">
          <g className="fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 5.5h14M3 10h14M3 14.5h9" />
          </g>
        </svg>
        Весь каталог
        <span
          aria-hidden="true"
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        >
          →
        </span>
      </Link>
    </div>
  );
}

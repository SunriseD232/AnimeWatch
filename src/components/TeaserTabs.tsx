'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';

/**
 * Переключатель «Новинки / Популярное» на главной.
 *
 * ПЕРЕКЛЮЧАЕТ НА МЕСТЕ, без перехода по ссылке. Раньше вкладки были обычными
 * ссылками на `/?tab=popular`, и работать они перестали ещё при редизайне
 * главной: в page.tsx стоит редирект — ЛЮБОЙ `?tab=` уводит на /catalog. То
 * есть клик по «Популярному» не менял ленту, а выкидывал человека со
 * страницы в полный каталог. Оба списка приходят с сервера сразу (они из
 * нашего же индекса, лишних запросов к чужим API нет), поэтому смена вкладки
 * — просто показ второго, уже готового.
 *
 * Модель — табы с автоматической активацией: стрелки сразу меняют панель,
 * как и клик (WAI-ARIA Tabs, вариант для лёгких панелей без ввода).
 */
export default function TeaserTabs({
  catalogHref,
  sortParam,
  fresh,
  popular,
}: {
  /** Ссылка на полный каталог; сортировка дописывается по активной вкладке. */
  catalogHref: string;
  /** Значения ?sort= для каталога: у аниме и кино они разные. */
  sortParam: { fresh: string; popular: string };
  fresh: ReactNode;
  popular: ReactNode;
}) {
  const [active, setActive] = useState<'fresh' | 'popular'>('fresh');
  const baseId = useId();

  // Показываем только ту вкладку, для которой есть содержимое: индекс мог
  // не дать одну из лент (крон не прогонялся по этому разделу).
  const tabs = [
    { key: 'fresh' as const, label: 'Новинки', body: fresh, sort: sortParam.fresh },
    { key: 'popular' as const, label: 'Популярное', body: popular, sort: sortParam.popular },
  ].filter((t) => t.body);

  if (tabs.length === 0) return null;
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`${baseId}-heading`}>
      {/* Заголовок только для скринридера: на экране роль заголовка играют
          сами вкладки. Без него в структуре страницы был провал — после
          «Продолжить просмотр» (h2) сразу шли названия карточек (h3), и
          переход по заголовкам выглядел как пропущенный уровень. */}
      <h2 id={`${baseId}-heading`} className="sr-only">
        Новинки и популярное
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Что показать"
          className="flex gap-2"
          onKeyDown={(e) => {
            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!step || tabs.length < 2) return;
            e.preventDefault();
            const i = tabs.findIndex((t) => t.key === current.key);
            const next = tabs[(i + step + tabs.length) % tabs.length];
            setActive(next.key);
            document.getElementById(`${baseId}-${next.key}`)?.focus();
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              id={`${baseId}-${t.key}`}
              type="button"
              role="tab"
              aria-selected={t.key === current.key}
              aria-controls={`${baseId}-panel`}
              tabIndex={t.key === current.key ? 0 : -1}
              onClick={() => setActive(t.key)}
              className={[
                'press rounded-full px-4 py-1.5 text-sm font-medium transition',
                t.key === current.key
                  ? 'bg-accent text-accent-fg'
                  : 'bg-bg-card text-gray-300 ring-1 ring-white/10 hover:bg-bg-soft',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Каталог — не вкладка, а отдельный переход: это форма поиска по
            фильтрам, а не ещё одна лента. Сортировку передаём ту же, что у
            активной вкладки, иначе человек теряет ряд, из которого нажал. */}
        <Link
          href={`${catalogHref}?sort=${current.sort}`}
          className="press group flex items-center gap-2 rounded-full bg-accent/15 px-4 py-1.5 text-sm font-semibold text-accent-text ring-1 ring-accent/30 transition hover:bg-accent hover:text-accent-fg hover:ring-accent"
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

      {/* key — чтобы при смене вкладки лента появлялась тем же мягким
          проявлением, что и остальные секции, а не подменялась мгновенно. */}
      <div
        key={current.key}
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-label={current.label}
        className="animate-tab-swap"
      >
        {current.body}
      </div>
    </section>
  );
}

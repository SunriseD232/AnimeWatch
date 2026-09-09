'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PARAM, parseView, type CatalogView } from '@/lib/animeFilters';

/**
 * Переключатель вида выдачи: плитки или список.
 *
 * Пишет прямо в URL, а не в общий черновик фильтров: вид — не условие
 * отбора, он ничего не ищет заново, и заставлять ради него нажимать
 * «Применить» было бы странно. Переход мгновенный, как у сортировки.
 *
 * Все остальные параметры сохраняются как есть — переключение вида не должно
 * сбрасывать ни фильтры, ни страницу, на которой человек находится.
 */
export default function ViewSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = parseView(searchParams.get(PARAM.view));

  function select(view: CatalogView) {
    if (view === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (view === 'grid') params.delete(PARAM.view);
    else params.set(PARAM.view, view);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    // Подписи «Вид:» нет: обе иконки говорят сами за себя, а активная ещё и
    // подсвечена акцентом. Название каждой — в title/aria-label кнопки.
    <div className="flex items-center gap-1">
      <ViewButton label="Плитки" active={current === 'grid'} onClick={() => select('grid')}>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-current">
          <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
          <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
        </svg>
      </ViewButton>

      <ViewButton label="Список" active={current === 'list'} onClick={() => select('list')}>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
          <rect x="2.5" y="3.5" width="4" height="4" rx="1" className="fill-current" />
          <rect x="2.5" y="12.5" width="4" height="4" rx="1" className="fill-current" />
          <path
            d="M9 5h8.5M9 8h6M9 14h8.5M9 17h6"
            className="fill-none stroke-current"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </ViewButton>
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`press rounded-lg p-1.5 transition ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

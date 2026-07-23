'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  genres: FilterOption[];
  sorts: FilterOption[];
  defaultSort: string;
}

/**
 * Панель каталога: чипы жанров с тремя состояниями (нейтрально → включить →
 * исключить → нейтрально) + выбор сортировки + сброс. Читает/пишет ТОЛЬКО
 * URL searchParams (`genres`, `exclude`, `sort`) — состояние фильтров не
 * держим в React, оно и так живёт в адресной строке. Это даёт «сохранение
 * фильтров при возврате назад» само собой — обычная навигация браузера.
 *
 * Одинаковый компонент для каталога аниме и каталога кино — genres/sorts
 * передаются снаружи, у каждого раздела свой список и своя семантика
 * значений (у аниме — числовой id жанра Shikimori, у кино — название
 * жанра текстом, см. lib/videoseed-catalog.ts).
 */
export default function GenreFilterPanel({ genres, sorts, defaultSort }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const include = (searchParams.get('genres') ?? '').split(',').filter(Boolean);
  const exclude = (searchParams.get('exclude') ?? '').split(',').filter(Boolean);
  const sort = searchParams.get('sort') ?? defaultSort;

  function navigate(nextInclude: string[], nextExclude: string[], nextSort: string) {
    const params = new URLSearchParams();
    if (nextInclude.length > 0) params.set('genres', nextInclude.join(','));
    if (nextExclude.length > 0) params.set('exclude', nextExclude.join(','));
    if (nextSort !== defaultSort) params.set('sort', nextSort);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function cycleGenre(value: string) {
    if (include.includes(value)) {
      navigate(
        include.filter((v) => v !== value),
        [...exclude, value],
        sort,
      );
    } else if (exclude.includes(value)) {
      navigate(
        include,
        exclude.filter((v) => v !== value),
        sort,
      );
    } else {
      navigate([...include, value], exclude, sort);
    }
  }

  const hasFilters = include.length > 0 || exclude.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-400">
          Сортировка:
          <select
            value={sort}
            onChange={(e) => navigate(include, exclude, e.target.value)}
            className="rounded-lg border border-white/10 bg-bg-card px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
          >
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={() => navigate([], [], sort)}
            className="press text-sm font-medium text-accent hover:text-accent-hover"
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      <div className="-mx-4 flex flex-wrap gap-2 px-4">
        {genres.map((g) => {
          const isIncluded = include.includes(g.value);
          const isExcluded = exclude.includes(g.value);
          return (
            <button
              key={g.value}
              type="button"
              onClick={() => cycleGenre(g.value)}
              aria-pressed={isIncluded}
              className={[
                'press rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                isIncluded
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : isExcluded
                    ? 'bg-red-500/15 text-red-300 line-through ring-1 ring-red-500/40'
                    : 'bg-bg-card text-gray-300 ring-1 ring-white/5 hover:bg-bg-soft hover:text-white',
              ].join(' ')}
            >
              {isIncluded ? '✓ ' : isExcluded ? '✕ ' : ''}
              {g.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

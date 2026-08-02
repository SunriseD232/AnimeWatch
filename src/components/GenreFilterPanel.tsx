'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  genres: FilterOption[];
  sorts: FilterOption[];
  defaultSort: string;
  /** Показать чекбокс "Показывать анонсы" — сейчас только у каталога аниме,
   *  у кино такого статуса тайтла нет (см. lib/videoseed-catalog.ts). */
  anonsToggle?: boolean;
}

/**
 * Панель каталога: чипы жанров с тремя состояниями (нейтрально → включить →
 * исключить → нейтрально) + выбор сортировки + сброс. Читает/пишет URL
 * searchParams (`genres`, `exclude`, `sort`) — применённое состояние живёт в
 * адресной строке, что даёт «сохранение фильтров при возврате назад» само
 * собой — обычная навигация браузера.
 *
 * Жанры — ЧЕРНОВОЕ состояние (pendingInclude/pendingExclude), не применяется
 * сразу: у каталога с несколькими AND/exclude-жанрами медленный путь
 * (см. getAnimeCatalog в lib/shikimori.ts — догружает десятки полных карточек
 * по одной), и раньше каждый клик по чипу сразу дёргал этот медленный запрос
 * — набрать 3-4 жанра означало 3-4 медленных перезагрузки подряд. Теперь
 * клики по чипам только копят выбор локально, применяются одним запросом по
 * кнопке «Применить». Сортировка и «Показывать анонсы» — быстрые сами по
 * себе, остаются мгновенными (но подхватывают текущий черновой выбор жанров,
 * чтобы не терять его молча).
 *
 * Одинаковый компонент для каталога аниме и каталога кино — genres/sorts
 * передаются снаружи, у каждого раздела свой список и своя семантика
 * значений (у аниме — числовой id жанра Shikimori, у кино — название
 * жанра текстом, см. lib/videoseed-catalog.ts).
 */
export default function GenreFilterPanel({ genres, sorts, defaultSort, anonsToggle }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const include = (searchParams.get('genres') ?? '').split(',').filter(Boolean);
  const exclude = (searchParams.get('exclude') ?? '').split(',').filter(Boolean);
  const sort = searchParams.get('sort') ?? defaultSort;
  const showAnons = searchParams.get('anons') === '1';

  const [pendingInclude, setPendingInclude] = useState(include);
  const [pendingExclude, setPendingExclude] = useState(exclude);

  // Подхватываем применённое состояние, если URL изменился НЕ через нашу же
  // applyNow ниже (переход назад/вперёд в браузере, прямой заход по ссылке
  // с параметрами) — applyNow сам приводит URL ровно к pending-значению, так
  // что после нашего собственного вызова этот эффект просто ничего не меняет.
  useEffect(() => {
    setPendingInclude(include);
    setPendingExclude(exclude);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('genres'), searchParams.get('exclude')]);

  function applyNow(
    nextInclude: string[],
    nextExclude: string[],
    nextSort: string,
    nextShowAnons: boolean,
  ) {
    const params = new URLSearchParams();
    if (nextInclude.length > 0) params.set('genres', nextInclude.join(','));
    if (nextExclude.length > 0) params.set('exclude', nextExclude.join(','));
    if (nextSort !== defaultSort) params.set('sort', nextSort);
    if (nextShowAnons) params.set('anons', '1');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function cycleGenre(value: string) {
    if (pendingInclude.includes(value)) {
      setPendingInclude(pendingInclude.filter((v) => v !== value));
      setPendingExclude([...pendingExclude, value]);
    } else if (pendingExclude.includes(value)) {
      setPendingExclude(pendingExclude.filter((v) => v !== value));
    } else {
      setPendingInclude([...pendingInclude, value]);
    }
  }

  function resetAll() {
    setPendingInclude([]);
    setPendingExclude([]);
    applyNow([], [], sort, showAnons);
  }

  const hasPending =
    pendingInclude.join(',') !== include.join(',') ||
    pendingExclude.join(',') !== exclude.join(',');
  const hasFilters = pendingInclude.length > 0 || pendingExclude.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            Сортировка:
            <select
              value={sort}
              onChange={(e) => applyNow(pendingInclude, pendingExclude, e.target.value, showAnons)}
              className="rounded-lg border border-white/10 bg-bg-card px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
            >
              {sorts.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {anonsToggle && (
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={showAnons}
                onChange={(e) => applyNow(pendingInclude, pendingExclude, sort, e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-bg-card accent-accent"
              />
              Показывать анонсы
            </label>
          )}
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={resetAll}
            className="press text-sm font-medium text-accent hover:text-accent-hover"
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      <div className="-mx-4 flex flex-wrap gap-2 px-4">
        {genres.map((g) => {
          const isIncluded = pendingInclude.includes(g.value);
          const isExcluded = pendingExclude.includes(g.value);
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

      {hasPending && (
        <div className="sticky bottom-4 z-10 flex items-center justify-center">
          <button
            type="button"
            onClick={() => applyNow(pendingInclude, pendingExclude, sort, showAnons)}
            className="press animate-rise rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/40 transition hover:bg-accent-hover"
          >
            Применить
          </button>
        </div>
      )}
    </div>
  );
}

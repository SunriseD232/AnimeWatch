'use client';

import Checkbox from '@/components/Checkbox';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Верхняя панель каталога аниме: сортировка, «Показывать анонсы» и чипы
 * жанров. Отличается от общего GenreFilterPanel (он остался у каталога кино)
 * только тем, что черновик берёт из общего контекста — чтобы жанры сверху и
 * фильтры в левой колонке применялись одной кнопкой.
 *
 * Сортировка и «анонсы» применяются сразу: сами по себе они быстрые, ждать
 * ради них «Применить» незачем. Но уходят вместе с текущим черновиком —
 * иначе накликанные, но не применённые жанры молча терялись бы.
 */
export default function AnimeGenrePanel({
  genres,
  sorts,
}: {
  genres: FilterOptionDef[];
  sorts: readonly FilterOptionDef[];
}) {
  const { pending, sort, showAnons, toggle, apply, statusOverridesAnons } = useAnonsAwareFilters();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-400">
          Сортировка:
          <select
            value={sort}
            onChange={(e) => apply({ sort: e.target.value })}
            className="rounded-lg border border-white/10 bg-bg-card px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
          >
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {/* При явно выбранном статусе галка ни на что не влияет (статус
            важнее — см. catalogQuery в lib/shikimori.ts), поэтому гасим её,
            а не оставляем висеть переключателем без эффекта. */}
        {!statusOverridesAnons && (
          <Checkbox
            checked={showAnons}
            onChange={(v) => apply({ showAnons: v })}
            label="Показывать анонсы"
          />
        )}
      </div>

      <div className="-mx-4 flex flex-wrap gap-2 px-4">
        {genres.map((g) => {
          const isIncluded = pending.genres.include.includes(g.value);
          const isExcluded = pending.genres.exclude.includes(g.value);
          return (
            <button
              key={g.value}
              type="button"
              onClick={() => toggle('genres', g.value)}
              aria-pressed={isIncluded ? true : isExcluded ? 'mixed' : false}
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

function useAnonsAwareFilters() {
  const ctx = useCatalogFilters();
  const s = ctx.pending.statuses;
  return { ...ctx, statusOverridesAnons: s.include.length > 0 || s.exclude.length > 0 };
}

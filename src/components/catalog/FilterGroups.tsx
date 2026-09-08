'use client';

import Checkbox from '@/components/Checkbox';
import TriStateCheckbox from '@/components/catalog/TriStateCheckbox';
import {
  KIND_OPTIONS,
  MAX_YEAR,
  MIN_YEAR,
  RATING_OPTIONS,
  STATUS_OPTIONS,
  type FilterOptionDef,
  type TriState,
} from '@/lib/animeFilters';
import {
  useCatalogFilters,
  type RangeField,
  type TriGroup,
} from '@/components/catalog/CatalogFilterProvider';

/**
 * Кирпичики панели фильтров, общие для десктопной раскрывающейся панели
 * (CatalogDesktopFilters) и мобильной выезжающей шторки (CatalogMobileDrawer).
 *
 * Вынесены отдельно именно потому, что мест теперь два: раскладка у них
 * разная (колонки под кнопкой «Фильтры» против шторки поверх выдачи), а сами
 * группы и их поведение обязаны совпадать до мелочей — иначе фильтр «Тип» на
 * телефоне и на компьютере со временем разъедутся.
 */

// Без рамки: поле различимо заливкой (bg-soft темнее карточки, читается как
// углубление), а фокус показывает кольцо — рамка поверх этого была лишней
// серой линией.
const INPUT_CLS =
  'w-full min-w-0 rounded-lg bg-bg-soft px-2 py-1.5 text-sm text-gray-100 outline-none transition focus:ring-1 focus:ring-accent [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none';

export function RangeGroup({
  title,
  fromField,
  toField,
  min,
  max,
  placeholderFrom,
  placeholderTo,
}: {
  title: string;
  fromField: RangeField;
  toField: RangeField;
  min: number;
  max: number;
  placeholderFrom: string;
  placeholderTo: string;
}) {
  const { pending, setRange } = useCatalogFilters();

  // Пустое поле — «граница не задана» (null), а не 0: иначе очистка поля
  // превращалась бы в фильтр «от нуля» и молча меняла выдачу.
  const onChange = (field: RangeField, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') return setRange(field, null);
    const n = Number(trimmed);
    if (Number.isFinite(n)) setRange(field, Math.trunc(n));
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={pending[fromField] ?? ''}
        onChange={(e) => onChange(fromField, e.target.value)}
        placeholder={placeholderFrom}
        aria-label={`${title} — от`}
        className={INPUT_CLS}
      />
      <span className="shrink-0 text-xs text-gray-500">—</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={pending[toField] ?? ''}
        onChange={(e) => onChange(toField, e.target.value)}
        placeholder={placeholderTo}
        aria-label={`${title} — до`}
        className={INPUT_CLS}
      />
    </div>
  );
}

export function EpisodesRange() {
  return (
    <RangeGroup
      title="Количество эпизодов"
      fromField="episodesFrom"
      toField="episodesTo"
      min={1}
      max={10000}
      placeholderFrom="1"
      placeholderTo="∞"
    />
  );
}

export function YearRange() {
  return (
    <RangeGroup
      title="Год релиза"
      fromField="yearFrom"
      toField="yearTo"
      min={MIN_YEAR}
      max={MAX_YEAR}
      placeholderFrom={String(MIN_YEAR)}
      placeholderTo={String(MAX_YEAR)}
    />
  );
}

export function CheckboxGroup({
  group,
  options,
}: {
  group: TriGroup;
  options: FilterOptionDef[];
}) {
  const { pending, toggle } = useCatalogFilters();
  const state = pending[group] as TriState;

  return (
    <div className="flex flex-col gap-0.5">
      {options.map((o) => (
        <TriStateCheckbox
          key={o.value}
          label={o.label}
          state={
            state.include.includes(o.value)
              ? 'include'
              : state.exclude.includes(o.value)
                ? 'exclude'
                : 'off'
          }
          onToggle={() => toggle(group, o.value)}
        />
      ))}
    </div>
  );
}

export function RatingGroup() {
  return <CheckboxGroup group="ratings" options={RATING_OPTIONS} />;
}

export function KindGroup() {
  return <CheckboxGroup group="kinds" options={KIND_OPTIONS} />;
}

export function StatusGroup() {
  return <CheckboxGroup group="statuses" options={STATUS_OPTIONS} />;
}

/** Чипы жанров. Их много (40+), поэтому на десктопе они живут наверху во всю
 *  ширину, а не в узкой колонке; на телефоне — внутри раскрывающейся секции
 *  мобильной панели. */
export function GenreChips({ genres }: { genres: FilterOptionDef[] }) {
  const { pending, toggle } = useCatalogFilters();

  return (
    <div className="flex flex-wrap gap-2">
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
  );
}

export function SortSelect({ sorts }: { sorts: readonly FilterOptionDef[] }) {
  const { sort, apply } = useCatalogFilters();

  return (
    <label className="flex items-center gap-2 text-sm text-gray-400">
      Сортировка:
      <select
        value={sort}
        onChange={(e) => apply({ sort: e.target.value })}
        className="rounded-lg bg-bg-soft px-3 py-1.5 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-accent"
      >
        {sorts.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Галка «Показывать анонсы». При явно выбранном статусе она ни на что не
 *  влияет (статус важнее — см. catalogQuery в lib/shikimori.ts), поэтому в
 *  таком случае не рисуется вовсе, а не висит переключателем без эффекта. */
export function AnonsToggle() {
  const { pending, showAnons, apply } = useCatalogFilters();
  const s = pending.statuses;
  if (s.include.length > 0 || s.exclude.length > 0) return null;

  return (
    <Checkbox
      checked={showAnons}
      onChange={(v) => apply({ showAnons: v })}
      label="Показывать анонсы"
    />
  );
}

/** Сколько пунктов выбрано в группе — для бейджа у свёрнутой секции на
 *  телефоне: иначе выбранный фильтр не виден, пока секцию не раскроешь. */
export function useGroupCount(group: TriGroup): number {
  const { pending } = useCatalogFilters();
  const s = pending[group] as TriState;
  return s.include.length + s.exclude.length;
}

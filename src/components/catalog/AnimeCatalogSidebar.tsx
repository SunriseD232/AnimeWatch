'use client';

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
import TriStateCheckbox from '@/components/catalog/TriStateCheckbox';

/**
 * Левая колонка каталога аниме: диапазоны (серии, год) и трёхпозиционные
 * группы (рейтинг, тип, статус). Жанры остаются наверху отдельной панелью —
 * их слишком много для узкой колонки.
 *
 * Ничего не применяет само: пишет только в общий черновик, применяет общая
 * кнопка «Применить» (см. CatalogFilterProvider) — как и было заведено у
 * жанров, чтобы медленный запрос уходил один раз на весь набор.
 */
export default function AnimeCatalogSidebar() {
  const { pending, hasFilters, reset } = useCatalogFilters();

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-white/5 bg-bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-100">Фильтры</p>
        {hasFilters && (
          <button
            type="button"
            onClick={reset}
            className="press text-xs font-medium text-accent hover:text-accent-hover"
          >
            Сбросить
          </button>
        )}
      </div>

      <RangeGroup
        title="Количество эпизодов"
        fromField="episodesFrom"
        toField="episodesTo"
        fromValue={pending.episodesFrom}
        toValue={pending.episodesTo}
        min={1}
        max={10000}
        placeholderFrom="1"
        placeholderTo="∞"
      />

      <RangeGroup
        title="Год релиза"
        fromField="yearFrom"
        toField="yearTo"
        fromValue={pending.yearFrom}
        toValue={pending.yearTo}
        min={MIN_YEAR}
        max={MAX_YEAR}
        placeholderFrom={String(MIN_YEAR)}
        placeholderTo={String(MAX_YEAR)}
      />

      <CheckboxGroup title="Возрастной рейтинг" group="ratings" options={RATING_OPTIONS} state={pending.ratings} />
      <CheckboxGroup title="Тип" group="kinds" options={KIND_OPTIONS} state={pending.kinds} />
      <CheckboxGroup title="Статус тайтла" group="statuses" options={STATUS_OPTIONS} state={pending.statuses} />

      <p className="text-xs leading-snug text-gray-500">
        Первое нажатие включает пункт, второе — исключает (крестик), третье снимает.
      </p>
    </div>
  );
}

function RangeGroup({
  title,
  fromField,
  toField,
  fromValue,
  toValue,
  min,
  max,
  placeholderFrom,
  placeholderTo,
}: {
  title: string;
  fromField: RangeField;
  toField: RangeField;
  fromValue: number | null;
  toValue: number | null;
  min: number;
  max: number;
  placeholderFrom: string;
  placeholderTo: string;
}) {
  const { setRange } = useCatalogFilters();

  // Пустое поле — «граница не задана» (null), а не 0: иначе очистка поля
  // превращалась бы в фильтр «от нуля серий» и молча меняла выдачу.
  const onChange = (field: RangeField, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') return setRange(field, null);
    const n = Number(trimmed);
    if (Number.isFinite(n)) setRange(field, Math.trunc(n));
  };

  const cls =
    'w-full min-w-0 rounded-lg border border-white/10 bg-bg-soft px-2 py-1.5 text-sm text-gray-100 outline-none transition focus:border-accent [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-200">{title}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={fromValue ?? ''}
          onChange={(e) => onChange(fromField, e.target.value)}
          placeholder={placeholderFrom}
          aria-label={`${title} — от`}
          className={cls}
        />
        <span className="shrink-0 text-xs text-gray-500">—</span>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={toValue ?? ''}
          onChange={(e) => onChange(toField, e.target.value)}
          placeholder={placeholderTo}
          aria-label={`${title} — до`}
          className={cls}
        />
      </div>
    </div>
  );
}

function CheckboxGroup({
  title,
  group,
  options,
  state,
}: {
  title: string;
  group: TriGroup;
  options: FilterOptionDef[];
  state: TriState;
}) {
  const { toggle } = useCatalogFilters();

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-200">{title}</p>
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
    </div>
  );
}

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

/**
 * Жанры списком внутри панели фильтров — теми же трёхпозиционными чекбоксами,
 * что и остальные группы.
 *
 * Раньше это была строка чипов во всю ширину над выдачей. С переходом на
 * актуальную таксономию Shikimori пунктов стало 80 вместо 46 (22 жанра,
 * 53 темы, 5 демографий), и такой строкой они отжимали бы у карточек
 * несколько экранов по вертикали.
 *
 * Показываем десять строк, остальное — прокруткой. Высота задана числом
 * (строка выходит ровно в 30px), а не рассчитывается по содержимому: иначе
 * список «дышал» бы при переключении пункта — у зачёркнутой подписи другая
 * метрика, — и полоса прокрутки дёргалась бы на каждый клик.
 */
export function GenreList({ genres }: { genres: FilterOptionDef[] }) {
  const { pending, toggle } = useCatalogFilters();

  return (
    <div className="max-h-[300px] overflow-y-auto pr-1">
      <div className="flex flex-col gap-0.5">
        {genres.map((g) => (
          <TriStateCheckbox
            key={g.value}
            label={g.label}
            state={
              pending.genres.include.includes(g.value)
                ? 'include'
                : pending.genres.exclude.includes(g.value)
                  ? 'exclude'
                  : 'off'
            }
            onToggle={() => toggle('genres', g.value)}
          />
        ))}
      </div>
    </div>
  );
}

/** Иконки сортировок — по смыслу самой сортировки, а не абстрактные стрелки:
 *  огонёк для свежего, звезда для оценки, кубок для популярности, «A» со
 *  стрелкой для алфавита. Ключи — значения из ANIME_CATALOG_SORTS. */
const SORT_ICONS: Record<string, React.ReactNode> = {
  // Огонёк — «сначала новые», то, что сейчас горячее.
  aired_on: (
    <path
      d="M7.4 12.4a2.1 2.1 0 0 0 2.1-2.1c0-1.1-.4-1.6-.8-2.4-.9-1.8-.2-3.4 1.6-5 .4 2.1 1.7 4.1 3.3 5.4 1.7 1.4 2.5 2.9 2.5 4.6a5.9 5.9 0 1 1-11.8 0c0-1 .4-1.9.8-2.5a2.1 2.1 0 0 0 2.3 2z"
      className="fill-none stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Звезда — оценка.
  ranked: (
    <path
      d="M10 2.4l2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5L2.8 7.6l5-.7z"
      className="fill-current"
    />
  ),
  // Кубок — популярность, то есть «первое место по числу зрителей».
  popularity: (
    <g>
      <path d="M6.6 2.8h6.8v3.9a3.4 3.4 0 0 1-6.8 0z" className="fill-current" />
      <path
        d="M6.6 4h-2a2.3 2.3 0 0 0 2.2 3.3M13.4 4h2a2.3 2.3 0 0 1-2.2 3.3M10 10.1v3.2"
        className="fill-none stroke-current"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M6.8 17l.6-2.4h5.2l.6 2.4z" className="fill-current" />
    </g>
  ),
  // «A» со стрелкой вниз — привычный значок сортировки по алфавиту.
  name: (
    <g className="fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.6 14.8L6 5.6l3.4 9.2M3.8 12h4.4" />
      <path d="M14.6 5.4v9.2M12.2 12.2l2.4 2.4 2.4-2.4" />
    </g>
  ),
};

export function SortSelect({ sorts }: { sorts: readonly FilterOptionDef[] }) {
  const { sort, apply } = useCatalogFilters();

  return (
    // Слово «Сортировка:» заменено иконкой текущей сортировки: подпись
    // занимала полстроки тулбара, повторяя то, что и так написано в самом
    // селекте. Название сортировки при этом осталось на месте — видно, что
    // выбрано, без раскрытия списка. Иконка вне <select> потому, что
    // разметку внутри <option> браузеры не рисуют.
    <label className="flex items-center gap-2 text-sm text-gray-400">
      <span className="sr-only">Сортировка</span>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0">
        {SORT_ICONS[sort]}
      </svg>
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

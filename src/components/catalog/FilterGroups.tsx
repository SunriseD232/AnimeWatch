'use client';

import Checkbox from '@/components/Checkbox';
import TriStateCheckbox from '@/components/catalog/TriStateCheckbox';
import { EMPTY_TRI, type FilterOptionDef, type RangeGroupDef, type TriGroupDef } from '@/lib/catalogFilters';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import SortDropdown from '@/components/catalog/SortDropdown';

/**
 * Кирпичики панели фильтров, общие для десктопной раскрывающейся панели
 * (CatalogDesktopFilters) и мобильной выезжающей шторки (CatalogMobileDrawer),
 * а через конфиг — ещё и для двух разных каталогов, аниме и кино.
 *
 * Ничего предметного здесь нет: что за группы и какие у них пункты, приходит
 * из конфига (lib/animeFilters.ts, lib/cinemaFilters.ts). Раньше тут лежали
 * KindGroup/StatusGroup/RatingGroup с зашитыми списками — при появлении
 * второго каталога это означало бы копию всей панели.
 */

// Без рамки: поле различимо заливкой (bg-soft темнее карточки, читается как
// углубление), а фокус показывает кольцо — рамка поверх этого была лишней
// серой линией.
const INPUT_CLS =
  'w-full min-w-0 rounded-lg bg-bg-soft px-2 py-1.5 text-sm text-gray-100 outline-none transition focus:ring-1 focus:ring-accent [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none';

export function RangeGroup({ def }: { def: RangeGroupDef }) {
  const { pending, setRange } = useCatalogFilters();

  // Пустое поле — «граница не задана» (null), а не 0: иначе очистка поля
  // превращалась бы в фильтр «от нуля» и молча меняла выдачу.
  const onChange = (field: string, raw: string) => {
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
        min={def.min}
        max={def.max}
        value={pending.range[def.fromField] ?? ''}
        onChange={(e) => onChange(def.fromField, e.target.value)}
        placeholder={def.fromPlaceholder}
        aria-label={`${def.title} — от`}
        className={INPUT_CLS}
      />
      <span className="shrink-0 text-xs text-gray-500">—</span>
      <input
        type="number"
        inputMode="numeric"
        min={def.min}
        max={def.max}
        value={pending.range[def.toField] ?? ''}
        onChange={(e) => onChange(def.toField, e.target.value)}
        placeholder={def.toPlaceholder}
        aria-label={`${def.title} — до`}
        className={INPUT_CLS}
      />
    </div>
  );
}

/**
 * Тело трёхпозиционной группы. Раскладка выбирается конфигом:
 *
 *  - 'checkboxes' — обычный столбик (тип, статус, рейтинг): пунктов
 *    единицы, все на виду.
 *  - 'list' — то же самое, но с прокруткой (жанры, страны): у аниме 80
 *    пунктов таксономии, у кино около 150 стран, и столбиком они отжали бы
 *    у карточек несколько экранов.
 *
 * Высота списка задана числом (строка выходит ровно в 30px), а не считается
 * по содержимому: иначе список «дышал» бы при переключении пункта — у
 * зачёркнутой подписи другая метрика, — и полоса прокрутки дёргалась бы на
 * каждый клик.
 */
export function TriGroupBody({
  def,
  options,
}: {
  def: TriGroupDef;
  options: FilterOptionDef[];
}) {
  const { pending, toggle } = useCatalogFilters();
  const state = pending.tri[def.key] ?? EMPTY_TRI;

  const items = (
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
          onToggle={() => toggle(def.key, o.value)}
        />
      ))}
    </div>
  );

  if (def.layout !== 'list') return items;
  return <div className="max-h-[300px] overflow-y-auto pr-1">{items}</div>;
}

/**
 * Иконки сортировок — по смыслу самой сортировки, а не абстрактные стрелки.
 * Ключи — значения из конфигов обоих каталогов (aired_on/new — свежесть,
 * ranked/rating — оценка, popularity — популярность, last_episode — дата
 * последней серии, name — алфавит).
 */
const FLAME = (
  <path
    d="M7.4 12.4a2.1 2.1 0 0 0 2.1-2.1c0-1.1-.4-1.6-.8-2.4-.9-1.8-.2-3.4 1.6-5 .4 2.1 1.7 4.1 3.3 5.4 1.7 1.4 2.5 2.9 2.5 4.6a5.9 5.9 0 1 1-11.8 0c0-1 .4-1.9.8-2.5a2.1 2.1 0 0 0 2.3 2z"
    className="fill-none stroke-current"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

const STAR = (
  <path
    d="M10 2.4l2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5L2.8 7.6l5-.7z"
    className="fill-current"
  />
);

const SORT_ICONS: Record<string, React.ReactNode> = {
  // Огонёк — «сначала новые», то, что сейчас горячее.
  aired_on: FLAME,
  new: FLAME,
  // Звезда — оценка.
  ranked: STAR,
  rating: STAR,
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
  // Календарь с галочкой — «по дате последней серии»: речь про дату выхода
  // свежего эпизода, и календарь читается однозначнее часов.
  last_episode: (
    <g className="fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.8" y="4.2" width="14.4" height="13" rx="2.2" />
      <path d="M2.8 8.2h14.4M6.6 2.6v3.2M13.4 2.6v3.2" />
      <path d="M7.4 12.6l1.9 1.9 3.5-3.5" />
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

export function SortSelect() {
  const { sort, apply, config } = useCatalogFilters();

  // Слово «Сортировка:» убрано: подпись занимала полстроки тулбара, повторяя
  // то, что и так написано в самом контроле. Значок текущей сортировки въехал
  // ВНУТРЬ кнопки — раньше он висел снаружи нативного select и не нажимался,
  // хотя выглядел его частью.
  return (
    <SortDropdown
      value={sort}
      options={config.sorts}
      icons={SORT_ICONS}
      onChange={(value) => apply({ sort: value })}
    />
  );
}

/** Галка «Показывать анонсы». Только у аниме (config.showAnonsToggle). При
 *  явно выбранном статусе она ни на что не влияет (статус важнее — см.
 *  catalogQuery в lib/shikimori.ts), поэтому в таком случае не рисуется
 *  вовсе, а не висит переключателем без эффекта. */
export function AnonsToggle() {
  const { pending, showAnons, apply, config } = useCatalogFilters();
  if (!config.showAnonsToggle) return null;

  const s = pending.tri.statuses ?? EMPTY_TRI;
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
export function useGroupCount(group: string): number {
  const { pending } = useCatalogFilters();
  const s = pending.tri[group] ?? EMPTY_TRI;
  return s.include.length + s.exclude.length;
}

/** Суммарно выбрано во всех группах и диапазонах — счётчик у кнопки
 *  «Фильтры». */
export function useTotalCount(): number {
  const { pending } = useCatalogFilters();
  let count = 0;
  for (const s of Object.values(pending.tri)) count += s.include.length + s.exclude.length;
  // Диапазон считается за одну единицу, а не за две границы: «год с 2000 по
  // 2010» — это один заданный фильтр, а не два.
  const ranges = new Set<string>();
  for (const [field, value] of Object.entries(pending.range)) {
    if (value != null) ranges.add(field.replace(/(From|To)$/, ''));
  }
  return count + ranges.size;
}

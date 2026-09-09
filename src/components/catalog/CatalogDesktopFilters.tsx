'use client';

import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import {
  EpisodesRange,
  GenreList,
  KindGroup,
  RatingGroup,
  StatusGroup,
  YearRange,
  useGroupCount,
} from '@/components/catalog/FilterGroups';
import type { FilterOptionDef } from '@/lib/animeFilters';

/**
 * Десктопные фильтры разнесены на две части: кнопка живёт в строке с
 * сортировкой, панель — колонкой слева от выдачи (см. CatalogArea, там же
 * вся геометрия и общее состояние «открыто»).
 *
 * Разнесены потому, что панель стоит в другом ряду разметки, чем кнопка: она
 * начинается на уровне первой карточки, а кнопка — строкой выше. Вложенной в
 * кнопку она этого не смогла бы.
 *
 * Размер окна, с которого панель перестаёт отнимать место у выдачи. Контент
 * прижат к центру (max-w-6xl у <main> — 1152px), слева от него остаётся
 * (100vw - 1152) / 2; панели нужно 208px плюс отступ 20px. Порог по высоте —
 * наравне с шириной: на низком окне панель всё равно не помещается целиком.
 *
 * Ниже любого из порогов панель встаёт настоящей колонкой и ужимает карточки;
 * выше — уходит в свободное поле накладкой и не трогает выдачу вовсе.
 *
 * Те же числа продублированы в брейкпоинте filters-side (tailwind.config.ts,
 * оттуда классы filters-side:*) и в globals.css (сетка карточек). Менять
 * только все три сразу.
 */
export const FILTERS_SIDE_MIN_WIDTH = 1745;
export const FILTERS_SIDE_MIN_HEIGHT = 890;

/** Помещается ли панель в поле страницы прямо сейчас. Только для обработчиков
 *  на клиенте — вёрстка те же условия берёт из CSS. */
export function filtersFitInMargin(): boolean {
  return (
    window.innerWidth >= FILTERS_SIDE_MIN_WIDTH &&
    window.innerHeight >= FILTERS_SIDE_MIN_HEIGHT
  );
}

export function FiltersTrigger({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { pending } = useCatalogFilters();
  const genres = useGroupCount('genres');
  const ratings = useGroupCount('ratings');
  const kinds = useGroupCount('kinds');
  const statuses = useGroupCount('statuses');
  const ranges =
    (pending.episodesFrom !== null || pending.episodesTo !== null ? 1 : 0) +
    (pending.yearFrom !== null || pending.yearTo !== null ? 1 : 0);
  const count = genres + ratings + kinds + statuses + ranges;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="press flex items-center gap-2 text-sm font-bold text-white"
    >
      {/* Иконка перетекает из трёх полосок в стрелку поворотом с
          растворением. Направление зависит от того, откуда панель берёт
          место: «ᐸ» — когда она уходит в свободное поле страницы и стоит
          левее всего контента; «⌄» — когда поля нет и она раскрывается
          колонкой ниже строки с кнопкой. Обе стрелки в разметке всегда,
          нужную выбирает брейкпоинт — без JS, чтобы не зависеть от
          гидратации. */}
      <span className="relative flex h-5 w-5 items-center justify-center">
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`absolute h-5 w-5 fill-none stroke-current stroke-2 transition-all duration-300 ${
            open ? '-rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
          }`}
        >
          <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
        </svg>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`absolute hidden h-5 w-5 fill-none stroke-current stroke-2 transition-all duration-300 filters-side:block ${
            open ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'
          }`}
        >
          <path d="M12.5 4 6.5 10l6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`absolute h-5 w-5 fill-none stroke-current stroke-2 transition-all duration-300 filters-side:hidden ${
            open ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
          }`}
        >
          <path d="M4 7.5 10 13.5l6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      Фильтры
      {/* Счётчик у свёрнутой кнопки — иначе заданный фильтр не виден совсем,
          и суженная выдача выглядит как поломка каталога. */}
      {count > 0 && (
        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Сама панель — просто блок во всю ширину родителя. Где она окажется и как
 * себя поведёт при прокрутке, решает колонка вокруг неё (см. CatalogArea):
 * без свободного поля это настоящая колонка слева от выдачи, с полем —
 * накладка в нём. И там, и там она узкая, поэтому группы внутри
 * идут одним столбиком.
 *
 * Своих absolute/sticky у панели быть НЕ должно: пока они тут были, панель
 * выпадала из потока и липкая обёртка схлопывалась в нулевую высоту —
 * прижимать было нечего, и панель уезжала ниже последних карточек.
 *
 * Фон — цвет страницы с прозрачностью и размытием на токене --bg, а не
 * сплошная заливка: при смене палитры в профиле панель меняется вместе со
 * всем остальным и не остаётся тёмным пятном.
 */
export function FiltersPanel({ genres }: { genres: FilterOptionDef[] }) {
  const { hasFilters, reset } = useCatalogFilters();

  return (
    <div className="animate-filters-panel w-full rounded-2xl bg-bg/80 p-3 backdrop-blur-xl">
      {/* Один столбик: панель всегда узкая (208px), раскладывать группы в
          несколько колонок тут негде. Порядок — от того, чем пользуются
          чаще: жанры, потом тип со статусом, рейтинг последним, а поля
          ввода в самом конце. */}
      <div className="flex flex-col gap-5">
        {/* Жанры переехали сюда из строки чипов над выдачей: пунктов в
            актуальной таксономии 80, и наверху они отжимали бы у карточек
            несколько экранов. */}
        <Group title="Жанры">
          <GenreList genres={genres} />
        </Group>

        <Group title="Тип">
          <KindGroup />
        </Group>
        <Group title="Статус тайтла">
          <StatusGroup />
        </Group>
        <Group title="Возрастной рейтинг">
          <RatingGroup />
        </Group>

        {/* Диапазоны — в конце: это единственные поля с вводом, остальное
            выбирается мышью, и держать их первыми значило бы начинать список
            с того, чем пользуются реже всего. */}
        <Group title="Количество эпизодов">
          <EpisodesRange />
        </Group>
        <Group title="Год релиза">
          <YearRange />
        </Group>
      </div>

      <div className="mt-4 flex items-start justify-between gap-3">
        <p className="text-xs leading-snug text-gray-500">
          Первое нажатие включает пункт, второе — исключает, третье снимает.
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={reset}
            className="press shrink-0 text-xs font-medium text-accent hover:text-accent-hover"
          >
            Сбросить
          </button>
        )}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      {/* Ровно тот же стиль, что у кнопки «Фильтры» в тулбаре
          (text-sm font-bold text-white): панель — её продолжение, и заголовки
          разделов должны читаться заодно с ней, а не спорить размером. */}
      <p className="mb-2 text-sm font-bold leading-5 text-white">{title}</p>
      {children}
    </div>
  );
}

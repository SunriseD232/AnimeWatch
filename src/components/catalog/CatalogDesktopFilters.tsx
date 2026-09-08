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
 * сортировкой, панель — отдельным узлом ниже (см. AnimeGenrePanel, там же
 * общее состояние «открыто»).
 *
 * Разнесены именно потому, что мест у панели два, и в разметке они разные:
 * на широком окне она уходит влево от контента накладкой, на узком встаёт
 * в поток над жанрами. Вложенной в кнопку она смогла бы только накладку.
 *
 * Ширина, с которой панель уходит влево. Контент прижат к центру
 * (max-w-6xl у <main> — 1152px), слева от него остаётся (100vw - 1152) / 2.
 * Панели нужно 208px плюс отступ 20px, значит окно от ~1600px. Это же
 * число зашито в классы min-[1600px]: ниже него панель раскрывается вниз и
 * раздвигает контент, а не перекрывает его — уводить её влево там значило
 * бы срезать половину за краем экрана.
 */
export const FILTERS_SIDE_BREAKPOINT = 1600;

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
      className="press flex items-center gap-2 text-sm font-medium text-white"
    >
      {/* Иконка перетекает из трёх полосок в стрелку поворотом с
          растворением. Направление стрелки совпадает с тем, КУДА реально
          поедет панель: влево — когда она уходит в поле сбоку (широкое
          окно), вниз — когда раскрывается над жанрами (узкое). Показывать
          «ᐸ» там, где содержимое появляется снизу, значило бы врать про
          собственное поведение. Обе стрелки в разметке всегда, нужную
          выбирает брейкпоинт — без JS, чтобы не зависеть от гидратации. */}
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
          className={`absolute hidden h-5 w-5 fill-none stroke-current stroke-2 transition-all duration-300 min-[1600px]:block ${
            open ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'
          }`}
        >
          <path d="M12.5 4 6.5 10l6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`absolute h-5 w-5 fill-none stroke-current stroke-2 transition-all duration-300 min-[1600px]:hidden ${
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
 * Сама панель. Одна и та же разметка в обоих режимах, разница только в
 * позиционировании:
 *
 * - до 1600px — обычный поток: блок между строкой сортировки и жанрами,
 *   раскрывается вниз и честно раздвигает то, что ниже;
 * - от 1600px — absolute вправо от левого края контента (right-full), то
 *   есть в пустое поле слева, ничего не перекрывая и не сдвигая.
 *
 * Фон — цвет страницы с прозрачностью и размытием на токене --bg, а не
 * сплошная заливка: при смене палитры в профиле панель меняется вместе со
 * всем остальным и не остаётся тёмным пятном.
 */
export function FiltersPanel({ genres }: { genres: FilterOptionDef[] }) {
  const { hasFilters, reset } = useCatalogFilters();

  return (
    <div className="w-full rounded-2xl bg-bg/80 p-3 backdrop-blur-xl min-[1600px]:absolute min-[1600px]:right-full min-[1600px]:top-0 min-[1600px]:z-30 min-[1600px]:mr-5 min-[1600px]:w-52">
      {/* В потоке панель занимает ШИРИНУ, а не высоту: пять групп в столбик
          на всю ширину контента — это почти 800px по вертикали, выдача
          уезжала бы за пределы экрана. Колонками получается около двухсот.
          Сбоку (от 1600px) наоборот — там узко, и группы идут в столбик.

          Группы сложены в колонки вручную, а не разложены сеткой 5×1:
          высота у них очень разная (в «Типе» семь пунктов, в диапазоне одна
          строка), и в общей сетке ряд равнялся бы по самой высокой — под
          диапазонами оставалась бы дыра в полпанели. Порядок чтения при
          этом сохранён, в том числе в режиме столбика. */}
      <div className="grid grid-cols-2 items-start gap-x-8 gap-y-6 xl:grid-cols-3 min-[1600px]:flex min-[1600px]:flex-col min-[1600px]:gap-5">
        <div className="flex flex-col gap-5">
          <Group title="Количество эпизодов">
            <EpisodesRange />
          </Group>
          <Group title="Год релиза">
            <YearRange />
          </Group>
        </div>

        {/* Жанры переехали сюда из строки чипов над выдачей: пунктов в
            актуальной таксономии 80, и наверху они отжимали бы у карточек
            несколько экранов. */}
        <Group title="Жанры">
          <GenreList genres={genres} />
        </Group>

        <Group title="Тип">
          <KindGroup />
        </Group>

        <div className="flex flex-col gap-5">
          <Group title="Статус тайтла">
            <StatusGroup />
          </Group>
          {/* Возрастной рейтинг — последним, тот же порядок и на телефоне
              (см. CatalogMobileDrawer). */}
          <Group title="Возрастной рейтинг">
            <RatingGroup />
          </Group>
        </div>
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
      <p className="mb-2 text-sm font-medium text-gray-200">{title}</p>
      {children}
    </div>
  );
}

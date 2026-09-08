'use client';

import { useEffect, useRef, useState } from 'react';
import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import {
  EpisodesRange,
  KindGroup,
  RatingGroup,
  StatusGroup,
  YearRange,
  useGroupCount,
} from '@/components/catalog/FilterGroups';

/**
 * Десктопный блок фильтров: кнопка «≡ Фильтры» слева, панель раскрывается
 * в пустое поле СЛЕВА от выдачи.
 *
 * Панель абсолютная — намеренно. Колонкой в потоке она сдвигала вправо и
 * жанры, и всю сетку карточек, то есть меняла положение того, ради чего на
 * страницу и заходят. Абсолютная в раскладке не занимает ничего.
 *
 * Куда именно она раскрывается, зависит от ширины окна. Контент прижат к
 * центру (max-w-6xl у <main>), и слева от него остаётся поле шириной
 * (100vw - 1152px) / 2. Панели нужно 208px плюс отступ, то есть окно от
 * ~1600px — с этой ширины она уходит ВЛЕВО, за край контента, и не
 * перекрывает ничего вообще. Уже — раскрывается под кнопкой поверх выдачи,
 * потому что слева места просто нет и уводить её туда значило бы срезать
 * половину за краем экрана.
 *
 * Фон — цвет страницы с прозрачностью и размытием, а не сплошная заливка:
 * оба значения берутся из токенов темы (--bg), поэтому при смене палитры в
 * профиле панель меняется вместе со всем остальным и не остаётся чёрным
 * пятном на светлевшем фоне.
 *
 * Про скролл: absolute (не fixed) прокручивается вместе со страницей, так
 * что даже панель выше экрана целиком достижима — своего поля прокрутки у
 * неё нет и не нужно.
 *
 * Жанры сюда не входят: их 46, они остаются строкой чипов во всю ширину.
 */
export default function CatalogDesktopFilters() {
  const [open, setOpen] = useState(false);
  const { pending, hasFilters, reset } = useCatalogFilters();
  const rootRef = useRef<HTMLDivElement>(null);

  const ratings = useGroupCount('ratings');
  const kinds = useGroupCount('kinds');
  const statuses = useGroupCount('statuses');
  const ranges =
    (pending.episodesFrom !== null || pending.episodesTo !== null ? 1 : 0) +
    (pending.yearFrom !== null || pending.yearTo !== null ? 1 : 0);
  const count = ratings + kinds + statuses + ranges;

  // Клик мимо и Escape закрывают — обычное поведение выпадающей панели.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="press flex items-center gap-2 text-sm font-medium text-white"
      >
        {/* Иконка перетекает из трёх полосок в «ᐸ»: обе лежат друг на друге
            и меняются местами поворотом с растворением. Отдельной стрелки-
            индикатора рядом больше нет — состояние показывает сама иконка. */}
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
            className={`absolute h-5 w-5 fill-none stroke-current stroke-2 transition-all duration-300 ${
              open ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'
            }`}
          >
            <path d="M12.5 4 6.5 10l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        Фильтры
        {/* Счётчик у свёрнутой кнопки — иначе заданный фильтр не виден
            совсем, и суженная выдача выглядит как поломка каталога. */}
        {count > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-3 w-52 rounded-2xl bg-bg/80 p-3 backdrop-blur-xl min-[1600px]:left-auto min-[1600px]:right-full min-[1600px]:top-0 min-[1600px]:mr-5 min-[1600px]:mt-0">
          <div className="flex flex-col gap-5">
            <Group title="Количество эпизодов">
              <EpisodesRange />
            </Group>
            <Group title="Год релиза">
              <YearRange />
            </Group>
            <Group title="Тип">
              <KindGroup />
            </Group>
            <Group title="Статус тайтла">
              <StatusGroup />
            </Group>
            {/* Возрастной рейтинг — последним, тот же порядок и на телефоне
                (см. CatalogMobileDrawer). */}
            <Group title="Возрастной рейтинг">
              <RatingGroup />
            </Group>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs leading-snug text-gray-500">
              Второе нажатие исключает пункт, третье снимает.
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
      )}
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

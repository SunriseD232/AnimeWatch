'use client';

import { useState } from 'react';
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
 * Десктопный блок фильтров — колонка слева от выдачи. Свёрнут до кнопки
 * «≡ Фильтры», раскрывается вниз внутри самой колонки, поэтому отдельной
 * строки над жанрами не занимает и ничего вниз не сдвигает.
 *
 * Про скролл. Раньше колонка была lg:sticky: пока влезала в экран —
 * держалась на месте, а как только переставала (все группы открыты) — низ
 * списка становился недостижим, потому что sticky приколачивает верх
 * элемента и вместе со страницей он уже не едет. Поэтому здесь обычный
 * поток: влезает — стоит на месте, скроллить нечего; не влезает —
 * поднимается и опускается вместе со страницей, как остальной контент.
 * Внутреннего overflow тоже нет намеренно — второе независимое поле
 * прокрутки рядом с основным только мешает.
 *
 * Жанры сюда не входят: их 46, в колонке шириной 14rem они превратились бы
 * в бесконечный столбец. Они остаются строкой чипов во всю ширину справа.
 */
export default function CatalogDesktopFilters() {
  const [open, setOpen] = useState(false);
  const { pending, hasFilters, reset } = useCatalogFilters();

  const ratings = useGroupCount('ratings');
  const kinds = useGroupCount('kinds');
  const statuses = useGroupCount('statuses');
  const ranges =
    (pending.episodesFrom !== null || pending.episodesTo !== null ? 1 : 0) +
    (pending.yearFrom !== null || pending.yearTo !== null ? 1 : 0);
  const count = ratings + kinds + statuses + ranges;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="press flex items-center gap-2 text-sm font-medium text-white"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          </svg>
          Фильтры
          {/* Счётчик у свёрнутого блока — иначе заданный фильтр не виден
              совсем, и суженная выдача выглядит как поломка каталога. */}
          {count > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
              {count}
            </span>
          )}
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={`h-4 w-4 fill-none stroke-gray-400 stroke-2 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

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

      {/* Раскрытые фильтры — без подложки и рамки, прямо на фоне страницы:
          карточка вокруг них смотрелась серым прямоугольником сбоку от
          выдачи и спорила с ней за внимание. */}
      {open && (
        <div className="mt-4 flex flex-col gap-5">
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

          <p className="text-xs leading-snug text-gray-500">
            Первое нажатие включает пункт, второе — исключает (крестик), третье снимает.
          </p>
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

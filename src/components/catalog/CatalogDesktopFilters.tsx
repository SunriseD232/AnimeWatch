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
 * Десктопная панель фильтров: кнопка «≡ Фильтры» раскрывается вниз.
 *
 * Раньше это была всегда открытая липкая колонка слева. Липкость и убрали:
 * пока панель влезала в экран, она держалась на месте, а как только
 * переставала — низ списка становился недостижим, потому что sticky
 * приколачивает верх элемента и вместе со страницей он уже не едет. Теперь
 * блок в обычном потоке: влезает — никуда не скроллится, не влезает —
 * поднимается и опускается вместе со страницей, как весь остальной контент.
 * Внутреннего скролла у панели нет намеренно, чтобы не появлялось второе
 * независимое поле прокрутки.
 *
 * Жанры сюда не входят: их 46, они живут отдельной строкой чипов во всю
 * ширину — в колонках этой панели они бы её раздули.
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
    <div className="hidden lg:block">
      <div className="flex items-center gap-3">
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
          {/* Счётчик у свёрнутой панели — иначе уже заданный фильтр не виден
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
            className="press text-sm font-medium text-accent hover:text-accent-hover"
          >
            Сбросить
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-2xl bg-bg-card p-5">
          {/* Группы сложены в колонки вручную, а не разложены единой сеткой
              5×1: высота у них очень разная (в «Типе» семь пунктов, в
              диапазоне одна строка), и в общей сетке ряд равнялся бы по
              самой высокой группе — под диапазонами оставалась дыра в
              полпанели. Так короткие группы стоят парами и панель вдвое
              ниже. Порядок чтения сохранён: рейтинг последний. */}
          <div className="grid items-start gap-x-8 gap-y-6 grid-cols-2 xl:grid-cols-3">
            <div className="flex flex-col gap-6">
              <Group title="Количество эпизодов">
                <EpisodesRange />
              </Group>
              <Group title="Год релиза">
                <YearRange />
              </Group>
            </div>

            <Group title="Тип">
              <KindGroup />
            </Group>

            <div className="flex flex-col gap-6">
              <Group title="Статус тайтла">
                <StatusGroup />
              </Group>
              {/* Возрастной рейтинг — последним, тот же порядок и на
                  телефоне (см. CatalogMobileDrawer). */}
              <Group title="Возрастной рейтинг">
                <RatingGroup />
              </Group>
            </div>
          </div>

          <p className="mt-5 text-xs text-gray-500">
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

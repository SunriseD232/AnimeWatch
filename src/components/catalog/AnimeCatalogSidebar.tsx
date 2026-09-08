'use client';

import { useCatalogFilters } from '@/components/catalog/CatalogFilterProvider';
import {
  EpisodesRange,
  KindGroup,
  RatingGroup,
  StatusGroup,
  YearRange,
} from '@/components/catalog/FilterGroups';

/**
 * Левая колонка каталога аниме: диапазоны (серии, год) и трёхпозиционные
 * группы (рейтинг, тип, статус). Жанры остаются наверху отдельной панелью —
 * их слишком много для узкой колонки.
 *
 * Только десктоп: на телефоне те же группы живут в выезжающей панели
 * (CatalogMobileDrawer) вместе с жанрами, и обе разом были бы дублем. Сами
 * группы при этом общие — см. FilterGroups.tsx.
 *
 * Ничего не применяет само: пишет только в общий черновик, применяет общая
 * кнопка «Применить» (см. CatalogFilterProvider) — как и было заведено у
 * жанров, чтобы медленный запрос уходил один раз на весь набор.
 */
export default function AnimeCatalogSidebar() {
  const { hasFilters, reset } = useCatalogFilters();

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

      <Group title="Количество эпизодов">
        <EpisodesRange />
      </Group>

      <Group title="Год релиза">
        <YearRange />
      </Group>

      <Group title="Возрастной рейтинг">
        <RatingGroup />
      </Group>

      <Group title="Тип">
        <KindGroup />
      </Group>

      <Group title="Статус тайтла">
        <StatusGroup />
      </Group>

      <p className="text-xs leading-snug text-gray-500">
        Первое нажатие включает пункт, второе — исключает (крестик), третье снимает.
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-200">{title}</p>
      {children}
    </div>
  );
}

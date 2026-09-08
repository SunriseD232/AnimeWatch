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
 * вниз под ней.
 *
 * Панель абсолютная — намеренно. Колонкой в потоке она сдвигала вправо и
 * жанры, и всю сетку карточек, то есть меняла положение того, ради чего на
 * страницу и заходят. Абсолютная не занимает в раскладке ничего: выдача
 * стоит ровно там же, где стояла бы без фильтров, а свёрнутая кнопка живёт
 * в уже существующей строке с сортировкой и лишней строки не создаёт.
 *
 * Фон панели — цвет самой страницы (bg), а не приподнятой карточки
 * (bg-card): накладке нужна непрозрачность, чтобы сквозь неё не просвечивали
 * карточки, но серым прямоугольником сбоку от выдачи она при этом не
 * выглядит.
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
  // Без этого она перекрывала бы жанры, пока о ней не вспомнят.
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
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2">
          <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
        </svg>
        Фильтры
        {/* Счётчик у свёрнутой кнопки — иначе заданный фильтр не виден
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

      {open && (
        <div className="absolute left-0 top-full z-30 mt-3 w-52 rounded-2xl bg-bg pb-4 shadow-2xl shadow-black/60">
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

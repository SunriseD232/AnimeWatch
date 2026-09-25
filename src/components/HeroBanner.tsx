import type { ReactNode } from 'react';
import Link from 'next/link';
import PosterImage from '@/components/PosterImage';
import QuickListButton from '@/components/QuickListButton';
import { PlayIcon } from '@/components/social/icons';
import type { HeroData } from '@/lib/recommendations';

/**
 * Hero-баннер главной (см. план редизайна) — широкий backdrop + заголовок
 * тайтла, подобранного кроном (lib/recommendationsEngine.ts) как «нравится
 * пользователю И достаточно популярен».
 *
 * children — слот под ModeSwitch: тот же компонент, что и раньше, просто
 * рендерится здесь оверлеем поверх картинки (см. CLAUDE.md/план), а не
 * отдельным блоком в потоке страницы — сам компонент и его логика не
 * меняются, меняется только то, куда его кладёт родитель.
 *
 * Высота фиксирована (не аспект-рейшо): на десктопе она же — высота соседней
 * колонки «Продолжить просмотр» (grid items-stretch), а на мобильном явный
 * клэмп важнее, чем пропорция картинки — иначе широкий (~4:1) backdrop
 * ужимается в полоску толщиной в пару строк текста.
 */
export default function HeroBanner({ hero, children }: { hero: HeroData; children?: ReactNode }) {
  const watchHref = hero.contentType === 'anime' ? `/anime/${hero.id}` : `/cinema/${hero.id}`;
  const meta = [hero.genres[0], hero.year, hero.rating ? hero.rating.toFixed(1) : null].filter(
    (v): v is string | number => v !== null && v !== undefined && v !== '',
  );

  return (
    <div className="relative h-[52vh] min-h-[320px] max-h-[420px] w-full overflow-hidden rounded-3xl bg-bg-card lg:h-[440px] lg:max-h-none">
      <PosterImage
        sources={[hero.backdropUrl]}
        alt=""
        priority
        className="absolute inset-0 h-full w-full object-cover"
        placeholderClassName="absolute inset-0 bg-bg-soft"
      />
      {/* Снизу сплошной — текст читается независимо от того, что на картинке
          (см. план: узкая полоска backdrop на мобильном могла попасть на
          светлый или пёстрый участок кадра). */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

      {children && <div className="absolute left-3 top-3 z-20 sm:left-4 sm:top-4">{children}</div>}

      {/* top-14/sm:top-16 — забронированная полоса под ModeSwitch сверху:
          без неё длинное название + описание + жанры на невысоком hero
          (min-h-[320px]) разрастались вверх и перекрывали переключатель
          раздела. justify-end внутри держит контент прижатым к низу, а
          overflow-hidden — последняя защита, если текста всё равно много:
          обрежется сверху, а не наедет на кнопки переключателя. */}
      <div className="absolute inset-x-0 bottom-0 top-14 z-10 flex flex-col justify-end gap-3 overflow-hidden p-4 sm:top-16 sm:p-6">
        {hero.genres.length > 0 && (
          <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {hero.genres.map((g) => (
              <span
                key={g}
                className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-gray-200 backdrop-blur"
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {/* Не <h1>: заголовок страницы — отдельный sr-only h1 в page.tsx
            («Аниме — MediaWatch»), а это promo-название конкретного тайтла,
            не заголовок страницы — два h1 на странице сбивали бы иерархию. */}
        <p className="line-clamp-2 text-2xl font-bold text-white sm:text-4xl">{hero.title}</p>

        {meta.length > 0 && (
          <p className="text-sm text-gray-300 sm:text-base">{meta.join(' · ')}</p>
        )}

        {hero.description && (
          <p className="line-clamp-2 max-w-2xl text-sm leading-relaxed text-gray-300 sm:line-clamp-3">
            {hero.description}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2">
          <Link
            href={watchHref}
            className="press flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover sm:flex-none"
          >
            <PlayIcon className="h-4 w-4" filled />
            Смотреть
          </Link>
          <QuickListButton
            shikimoriId={hero.id}
            contentType={hero.contentType}
            title={hero.title}
            posterUrl={null}
          />
        </div>
      </div>
    </div>
  );
}

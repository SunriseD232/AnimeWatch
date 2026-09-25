import ScrollCarousel from '@/components/ScrollCarousel';
import AnimeCard from '@/components/AnimeCard';
import CinemaCard from '@/components/CinemaCard';
import type { ShikimoriAnimeShort } from '@/lib/shikimoriShared';
import type { CinemaShort } from '@/lib/videoseed-catalog';

type Props =
  | { contentType: 'anime'; items: ShikimoriAnimeShort[] }
  | { contentType: 'cinema'; items: CinemaShort[] };

/**
 * Карусель «Рекомендуем посмотреть» — данные уже готовы к рендеру
 * (lib/recommendations.ts решает персонально/фоллбэк на популярное), здесь
 * только вёрстка. Ширина карточек — как у существующего PlannedCarousel:
 * единый масштаб карточек по всем каруселям главной.
 */
export default function RecommendedCarousel(props: Props) {
  if (props.items.length === 0) return null;

  return (
    <ScrollCarousel className="carousel-room flex snap-x gap-3 overflow-x-auto">
      {props.contentType === 'anime'
        ? props.items.map((a) => (
            <div key={a.id} className="w-28 shrink-0 snap-start sm:w-[134px]">
              <AnimeCard anime={a} />
            </div>
          ))
        : props.items.map((c) => (
            <div key={c.id} className="w-28 shrink-0 snap-start sm:w-[134px]">
              <CinemaCard item={c} />
            </div>
          ))}
    </ScrollCarousel>
  );
}

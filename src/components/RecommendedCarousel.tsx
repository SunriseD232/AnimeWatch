import ScrollCarousel from '@/components/ScrollCarousel';
import AnimeCard from '@/components/AnimeCard';
import CinemaCard from '@/components/CinemaCard';
import type { ShikimoriAnimeShort } from '@/lib/shikimoriShared';
import type { CinemaShort } from '@/lib/videoseed-catalog';

type Props = (
  | { contentType: 'anime'; items: ShikimoriAnimeShort[] }
  | { contentType: 'cinema'; items: CinemaShort[] }
) & {
  /**
   * Сколько рядов карточек в ленте. Два — у «Новинок» и «Популярного» на
   * главной: один ряд показывал шесть карточек из двенадцати, и половина
   * списка пропадала за краем экрана, хотя места по вертикали хватало.
   * Прокрутка остаётся горизонтальной, карточки просто идут по столбцам.
   */
  rows?: 1 | 2;
};

/**
 * Горизонтальная карусель карточек — общая для «Рекомендуем посмотреть»,
 * «Новинок» и «Популярного». Данные приходят готовыми, здесь только вёрстка.
 * Ширина карточек одна на все карусели главной.
 */
export default function RecommendedCarousel({ rows = 1, ...props }: Props) {
  if (props.items.length === 0) return null;

  // grid-flow-col с двумя рядами раскладывает карточки по столбцам сверху
  // вниз, а столбцы — слева направо: ровно то же движение ленты, что и у
  // одного ряда, только плотнее вдвое. Ширина колонки задана здесь, а не на
  // карточке: в гриде shrink-0 на элементе уже ни на что не влияет.
  const cls =
    rows === 2
      ? 'carousel-room grid snap-x grid-flow-col grid-rows-2 gap-3 overflow-x-auto [grid-auto-columns:7rem] sm:[grid-auto-columns:134px]'
      : 'carousel-room flex snap-x gap-3 overflow-x-auto';
  const itemCls = rows === 2 ? 'snap-start' : 'w-28 shrink-0 snap-start sm:w-[134px]';

  return (
    <ScrollCarousel className={cls}>
      {props.contentType === 'anime'
        ? props.items.map((a) => (
            <div key={a.id} className={itemCls}>
              <AnimeCard anime={a} />
            </div>
          ))
        : props.items.map((c) => (
            <div key={c.id} className={itemCls}>
              <CinemaCard item={c} />
            </div>
          ))}
    </ScrollCarousel>
  );
}

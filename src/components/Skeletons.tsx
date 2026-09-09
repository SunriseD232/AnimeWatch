/** Скелетон карточки-постера (2:3). */
export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="skeleton aspect-[2/3] w-full" />
      <div className="skeleton h-4 w-3/4" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}

/** Скелетон широкой карточки (16:9). */
export function WideCardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="skeleton aspect-video w-full" />
      <div className="skeleton h-4 w-3/4" />
    </div>
  );
}

/** Сетка скелетонов-постеров. */
export function CardGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Скелетон горизонтальной карусели.
 *
 * Обычная сетка тут не подходит: «Продолжить просмотр» — это ряд широких
 * карточек 16:9, и подменять его сеткой постеров 2:3 значит показать одну
 * раскладку, а через мгновение перерисовать в другую. Прыжок раздражает
 * сильнее, чем пустое место.
 */
export function CarouselSkeleton({
  count = 4,
  wide = true,
}: {
  count?: number;
  wide?: boolean;
}) {
  return (
    <div className="flex gap-3 overflow-hidden pb-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={wide ? 'w-56 shrink-0 sm:w-72' : 'w-28 shrink-0 sm:w-[134px]'}
        >
          <div className={`skeleton w-full ${wide ? 'aspect-video' : 'aspect-[2/3]'}`} />
          <div className="skeleton mt-2 h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/** Скелетон списочного вида каталога: постер слева, текст справа. */
export function ListRowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-4 rounded-2xl bg-bg-card p-3">
          <div className="skeleton aspect-[3/4] w-24 shrink-0 rounded-xl sm:w-28" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-3 w-1/4" />
            <div className="skeleton mt-1 h-3 w-full" />
            <div className="skeleton h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

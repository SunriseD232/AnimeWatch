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

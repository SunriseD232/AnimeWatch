/**
 * Скелетон страницы тайтла (аниме/кино) — используется в loading.tsx обоих
 * маршрутов. Next.js показывает его СРАЗУ при переходе (встроенный Suspense
 * вокруг сегмента маршрута), поэтому клик по карточке в подборке мгновенно
 * меняет страницу вместо полноэкранного лоадера поверх старой (см.
 * CinemaCard/AnimeCard — теперь обычный Link без TransitionLink).
 */
export default function TitlePageSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-8">
        <div className="skeleton mx-auto aspect-[2/3] w-40 shrink-0 sm:mx-0 sm:w-48" />

        <div className="flex flex-1 flex-col gap-3">
          <div className="skeleton h-8 w-2/3 max-w-sm" />

          <div className="flex flex-wrap gap-2">
            <div className="skeleton h-6 w-14" />
            <div className="skeleton h-6 w-20" />
            <div className="skeleton h-6 w-12" />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <div className="skeleton h-10 w-44 rounded-full" />
            <div className="skeleton h-10 w-10 rounded-full" />
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <div className="skeleton h-3 w-full max-w-lg" />
            <div className="skeleton h-3 w-full max-w-md" />
            <div className="skeleton h-3 w-2/3 max-w-sm" />
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div className="skeleton h-6 w-20" />
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
          {Array.from({ length: 16 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="skeleton aspect-video w-full" />
          ))}
        </div>
      </section>
    </div>
  );
}

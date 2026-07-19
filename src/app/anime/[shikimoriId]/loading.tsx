/** Мгновенный скелетон страницы тайтла (постер + текст + сетка серий). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="skeleton mx-auto aspect-[2/3] w-40 shrink-0 rounded-xl sm:mx-0 sm:w-48" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="skeleton h-7 w-2/3" />
          <div className="flex gap-2">
            <div className="skeleton h-6 w-14" />
            <div className="skeleton h-6 w-16" />
            <div className="skeleton h-6 w-12" />
          </div>
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton mt-1 h-10 w-48 rounded-lg" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="skeleton h-6 w-32" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
        <div className="skeleton h-4 w-2/3" />
      </div>
    </div>
  );
}

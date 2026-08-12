/** Мгновенный скелетон профиля: список/история грузятся из Supabase, см. page.tsx. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="skeleton h-6 w-24" />
          <div className="skeleton h-4 w-40" />
        </div>
        <div className="skeleton h-9 w-20 rounded-lg" />
      </section>

      <div className="flex gap-2">
        <div className="skeleton h-9 w-24 rounded-lg" />
        <div className="skeleton h-9 w-24 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="flex flex-col gap-2">
            <div className="skeleton aspect-[2/3] w-full" />
            <div className="skeleton h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Мгновенный скелетон календаря: список онгоингов догружается по одному
 *  (Shikimori-запрос на каждый тайтл из «Смотрю», см. page.tsx) — заметно
 *  медленнее одного каталожного запроса. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="skeleton h-7 w-64" />
        <div className="skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="flex items-center gap-3 rounded-xl bg-bg-card p-2.5 ring-1 ring-white/5">
            <div className="skeleton h-16 w-11 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-3 w-1/3" />
            </div>
            <div className="skeleton h-3 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

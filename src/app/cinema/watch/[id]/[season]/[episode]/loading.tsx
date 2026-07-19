/**
 * Мгновенный скелетон страницы просмотра: показывается сразу при переходе,
 * пока сервер опрашивает балансеры (Vibix/Kodik/Videoseed) и прогресс.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="skeleton h-6 w-2/3 max-w-sm" />
        <div className="skeleton h-4 w-32" />
      </div>
      <div className="skeleton flex aspect-video w-full items-center justify-center rounded-xl">
        <span className="animate-pulse text-sm text-gray-400">
          Загружаем плеер…
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="skeleton h-10 w-24 rounded-lg" />
        <div className="skeleton h-10 w-24 rounded-lg" />
      </div>
    </div>
  );
}

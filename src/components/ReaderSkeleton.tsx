/**
 * Заглушка читалки (манга, ранобэ, книги), пока сервер собирает главу.
 *
 * Глава — это поход к источнику (а у манги ещё и сведение источников), и
 * без заглушки переход по «Читать» несколько секунд ничего не менял на
 * экране: выглядело, будто сайт завис (24.10.2026). Форма повторяет
 * читалку — панель сверху и область страниц, — чтобы при появлении главы
 * ничего не прыгало. Подпись — для тех, кто не видит анимации (и для
 * экранного диктора: role="status").
 */
export default function ReaderSkeleton({ label = 'Загружаем главу…' }: { label?: string }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <div className="flex items-center gap-2">
        <div className="skeleton h-9 w-24 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="skeleton h-4 w-48 max-w-full" />
          <div className="skeleton h-3 w-32 max-w-full" />
        </div>
        <div className="skeleton h-9 w-9 rounded-full" />
        <div className="skeleton h-9 w-9 rounded-full" />
      </div>
      <div
        role="status"
        className="grid h-[max(420px,calc(100dvh-11rem))] place-items-center rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5"
      >
        <div className="flex flex-col items-center gap-3 text-sm text-gray-400">
          <span
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-accent motion-reduce:animate-none"
          />
          {label}
        </div>
      </div>
    </div>
  );
}

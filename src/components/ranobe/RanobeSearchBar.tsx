/**
 * Поиск по ранобэ. Обычная GET-форма: результат — адрес `/ranobe?q=…`, его
 * можно переслать и сохранить в закладки, и он работает без JavaScript.
 *
 * Почему не автопоиск по мере ввода: каждый запрос уходит в Renovels, а
 * каталог из своего индекса показывается сразу, без сети.
 */
export default function RanobeSearchBar({
  initialQuery,
  initialKind,
}: {
  initialQuery: string;
  initialKind: string;
}) {
  return (
    <form action="/ranobe" method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
      {/* Тип при поиске сбрасываем: человек ищет по всему каталогу, а не
          внутри выбранного происхождения. */}
      {initialKind ? <input type="hidden" name="kind" value="" /> : null}

      <div className="relative flex-1">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 fill-none stroke-gray-400"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-3.6-3.6" />
        </svg>
        <input
          type="search"
          name="q"
          defaultValue={initialQuery}
          placeholder="Название — например, «Начало после конца»"
          aria-label="Поиск ранобэ"
          className="w-full rounded-full border border-white/10 bg-bg-card py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-gray-500 focus:border-accent"
        />
      </div>

      <button
        type="submit"
        className="press shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg"
      >
        Найти
      </button>
    </form>
  );
}

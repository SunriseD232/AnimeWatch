/**
 * Поиск по книгам. Обычная GET-форма, без клиентского состояния: результат
 * — это адрес `/books?q=…`, его можно переслать и сохранить в закладки, и он
 * работает без JavaScript.
 *
 * Почему не автопоиск по мере ввода: каждый запрос уходит в OPDS Флибусты
 * (это внешний запрос на каждый символ), а каталог у нас и так показывается
 * без запроса.
 */
export default function BookSearchBar({
  initialQuery,
  initialGenre,
}: {
  initialQuery: string;
  initialGenre: string;
}) {
  return (
    <form action="/books" method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
      {/* Жанр при поиске сбрасываем: человек ищет по всему каталогу, а не
          внутри выбранного жанра, и оставленный скрытый фильтр удивлял бы
          пустой выдачей. */}
      {initialGenre ? <input type="hidden" name="genre" value="" /> : null}

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
          placeholder="Название или автор — например, «Стругацкий»"
          aria-label="Поиск книг"
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

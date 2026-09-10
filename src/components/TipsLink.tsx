import Link from 'next/link';

/** Ссылка на страницу подсказок — та же иконочная кнопка, что у CalendarLink. */
export default function TipsLink() {
  return (
    <Link
      href="/tips"
      aria-label="Подсказки"
      title="Подсказки"
      className="press hidden rounded-full p-2 text-gray-300 transition hover:bg-white/5 hover:text-white sm:block"
    >
      {/* Значок вместо 💡 — по той же причине, что у CalendarLink. */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-5 w-5 fill-none stroke-current"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .9 1.6l.1.6h5.2l.1-.6c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3Z" />
      </svg>
    </Link>
  );
}

import Link from 'next/link';

/** Ссылка на страницу подсказок — та же иконочная кнопка, что у CalendarLink. */
export default function TipsLink() {
  return (
    <Link
      href="/tips"
      aria-label="Подсказки"
      title="Подсказки"
      className="press hidden rounded-full px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5 hover:text-white sm:block"
    >
      💡
    </Link>
  );
}

import Link from 'next/link';

interface Props {
  href: string;
  icon: string;
  title: string;
  description: string;
}

/**
 * Большая навигационная плитка — «Популярное»/«Новинки»/«Каталог» на
 * главной. Один и тот же компонент для аниме и кино — единая структура
 * навигации для обоих разделов.
 */
export default function NavTile({ href, icon, title, description }: Props) {
  return (
    <Link
      href={href}
      className="card-lift group flex flex-col gap-2 rounded-2xl bg-bg-card p-6 ring-1 ring-white/5 transition hover:ring-accent/60"
    >
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-lg font-bold text-gray-100">{title}</h2>
      <p className="text-sm text-gray-400">{description}</p>
    </Link>
  );
}

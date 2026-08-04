import Link from 'next/link';

interface Props {
  page: number;
  /** null — соответствующая сторона недоступна (первая/последняя страница). */
  prevHref: string | null;
  nextHref: string | null;
}

/**
 * «← Пред. / Стр. N / След. →» — общий блок пагинации каталогов
 * (аниме/кино × каталог/новинки/популярное/главная). Раньше отключённая
 * сторона рендерилась как `<Link href="#">` с `pointer-events-none` —
 * визуально гасит клик мышью, но НЕ активацию с клавиатуры (Tab дотягивался
 * до "отключённой" ссылки, Enter всё равно уходил по href="#"). Здесь
 * недоступная сторона — обычный <span>, не фокусируемый и не кликабельный
 * в принципе, а не притворяющаяся отключённой ссылка.
 */
export default function Pagination({ page, prevHref, nextHref }: Props) {
  const baseClass =
    'rounded-full px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition';
  return (
    <div className="flex items-center justify-center gap-2">
      {prevHref ? (
        <Link href={prevHref} className={`${baseClass} bg-bg-card text-gray-100 hover:bg-bg-soft`}>
          ← Пред.
        </Link>
      ) : (
        <span aria-disabled="true" className={`${baseClass} bg-bg-card/50 text-gray-400`}>
          ← Пред.
        </span>
      )}
      <span className="px-2 text-sm text-gray-400">Стр. {page}</span>
      {nextHref ? (
        <Link href={nextHref} className={`${baseClass} bg-bg-card text-gray-100 hover:bg-bg-soft`}>
          След. →
        </Link>
      ) : (
        <span aria-disabled="true" className={`${baseClass} bg-bg-card/50 text-gray-400`}>
          След. →
        </span>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';

interface Props {
  page: number;
  /** null — соответствующая сторона недоступна (первая/последняя страница). */
  prevHref: string | null;
  nextHref: string | null;
  /**
   * id блока, к которому подниматься при листании (главная: раздел
   * «Новинки/Популярное»).
   *
   * Зачем. Next по умолчанию прокручивает страницу в самый верх при каждой
   * навигации, а кнопки листания стоят ВНИЗУ длинной выдачи — после клика
   * человек оказывался в шапке сайта и листал обратно, чтобы увидеть новую
   * страницу. Без id (каталог) поведение прежнее: там выдача и так начинается
   * почти от верха.
   */
  scrollToId?: string;
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
export default function Pagination({ page, prevHref, nextHref, scrollToId }: Props) {
  const baseClass =
    'rounded-full px-4 py-2 text-sm font-medium ring-1 ring-white/10 transition';

  // Прокручиваем СРАЗУ по клику, не дожидаясь новой страницы: она рисуется
  // сервером и приезжает через сотни миллисекунд, а подъём к разделу за это
  // время успевает пройти мягко. Ждать ответа значило бы получить рывок уже
  // после подмены содержимого.
  const onNavigate = scrollToId
    ? () => {
        // Плавность — по системной настройке: явный behavior в JS сильнее
        // css-правила scroll-behavior, поэтому спрашиваем сами.
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document
          .getElementById(scrollToId)
          ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
    : undefined;
  return (
    <div className="flex items-center justify-center gap-2">
      {prevHref ? (
        <Link
          href={prevHref}
          scroll={!scrollToId}
          onClick={onNavigate}
          className={`${baseClass} bg-bg-card text-gray-100 hover:bg-bg-soft`}
        >
          ← Пред.
        </Link>
      ) : (
        <span aria-disabled="true" className={`${baseClass} bg-bg-card/50 text-gray-400`}>
          ← Пред.
        </span>
      )}
      <span className="px-2 text-sm text-gray-400">Стр. {page}</span>
      {nextHref ? (
        <Link
          href={nextHref}
          scroll={!scrollToId}
          onClick={onNavigate}
          className={`${baseClass} bg-bg-card text-gray-100 hover:bg-bg-soft`}
        >
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

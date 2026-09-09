'use client';

import { useEffect, useState } from 'react';

/**
 * Постер с запасными ссылками.
 *
 * Зачем. Постеры приходят из трёх разных мест, и каждое иногда отдаёт 404:
 * Shikimori (индекс каталога), Yummy/yani.tv (им подменяются постеры на
 * главной — у Shikimori часть тайтлов с плейсхолдером вместо обложки, см.
 * withYummyPosters в lib/shikimori.ts) и Videoseed через собственный прокси.
 * Обычный <img> в таком случае оставляет на карточке битую картинку —
 * пустой прямоугольник с иконкой сломанного изображения, и выглядит это
 * хуже, чем честная надпись «нет постера».
 *
 * Ссылок может быть несколько: пробуем по очереди и показываем заглушку
 * только когда не осталось ни одной. На практике это чинит самый частый
 * случай — Yummy не ответил, а превью Shikimori для того же тайтла живо.
 *
 * Именно <img>, а не next/image: Shikimori режет хотлинк по Referer (отсюда
 * referrerPolicy), а прокси next/image ходит с серверных IP и там же
 * рейт-лимитится — картинки пропадали пачками. Прямая загрузка из браузера
 * стабильнее.
 */
export default function PosterImage({
  sources,
  alt,
  className,
  loading = 'lazy',
  placeholderClassName = 'grid h-full w-full place-items-center text-gray-400',
}: {
  /** Ссылки по убыванию предпочтительности; пустые и повторы отбрасываются. */
  sources: (string | null | undefined)[];
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  placeholderClassName?: string;
}) {
  const chain = [...new Set(sources.filter((s): s is string => Boolean(s)))];
  // Ключ списка отдельной переменной — иначе eslint не может проверить
  // зависимость эффекта статически (выражение в массиве зависимостей).
  const chainKey = chain.join('|');
  const [index, setIndex] = useState(0);

  // Список сменился (перерисовали карточку под другой тайтл) — начинаем с
  // начала, иначе новый постер унаследовал бы «сломанность» прошлого.
  useEffect(() => {
    setIndex(0);
  }, [chainKey]);

  if (chain.length === 0 || index >= chain.length) {
    return <div className={placeholderClassName}>нет постера</div>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // key по конкретной ссылке: без него React переиспользует тот же <img>
      // и в Safari onError по новому src иногда не срабатывает вовсе —
      // элемент остаётся в состоянии ошибки от прошлой попытки.
      key={chain[index]}
      src={chain[index]}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setIndex((i) => i + 1)}
      className={className}
    />
  );
}

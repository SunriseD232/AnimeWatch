'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicUser } from '@/lib/social/types';

/**
 * Круглый аватар. Нет картинки — первая буква имени на акцентной подложке.
 *
 * alt пустой намеренно: аватар везде стоит рядом с именем, и скринридер
 * иначе прочитал бы имя дважды подряд.
 */

const SIZES = {
  xs: { box: 'h-6 w-6 text-[11px]', px: 24 },
  sm: { box: 'h-8 w-8 text-xs', px: 32 },
  md: { box: 'h-10 w-10 text-sm', px: 40 },
  lg: { box: 'h-16 w-16 text-2xl', px: 64 },
  xl: { box: 'h-24 w-24 text-4xl', px: 96 },
} as const;

export type AvatarSize = keyof typeof SIZES;

function initialOf(name: string): string {
  // Array.from, а не name[0]: у эмодзи и части иероглифов первый «символ»
  // строки — половина суррогатной пары, и на месте буквы рисовался квадрат.
  const first = Array.from(name.trim())[0] ?? '?';
  return first.toUpperCase();
}

export default function Avatar({
  user,
  size = 'sm',
  className = '',
}: {
  user: Pick<PublicUser, 'name' | 'avatarUrl'>;
  size?: AvatarSize;
  className?: string;
}) {
  const { box, px } = SIZES[size];
  // Файл аватара мог пропасть (переезд диска, ручная чистка) — тогда вместо
  // тёмного пустого круга показываем букву, как у тех, кто фото не ставил.
  const [broken, setBroken] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // Картинка из серверной разметки может успеть не загрузиться ДО гидрации —
  // тогда onError уже прозвучал без слушателя. Досматриваем вручную.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setBroken(true);
  }, [user.avatarUrl]);
  if (user.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={user.avatarUrl}
        alt=""
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={`${box} shrink-0 rounded-full bg-bg-soft object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} grid shrink-0 select-none place-items-center rounded-full bg-accent/15 font-semibold text-accent-text ${className}`}
    >
      {initialOf(user.name)}
    </span>
  );
}

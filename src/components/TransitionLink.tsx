'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import NavigationOverlay from './NavigationOverlay';

/**
 * <Link>, но клик сразу показывает полноэкранный лоадер (см.
 * NavigationOverlay), пока целевая страница грузится — вместо того, чтобы
 * оставлять текущую страницу кликабельной и выглядящей так, будто клик
 * ничего не сделал, до самого появления новой. Тот же приём, что у
 * ModeSwitch/SiteLogoLink (у них своя реализация из-за доп. логики —
 * активной вкладки+куки и проверки «уже дома» соответственно) — тут общий
 * вариант для карточек тайтлов и прочих обычных переходов.
 */
export default function TransitionLink({
  href,
  children,
  className,
  prefetch,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  prefetch?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Link
        href={href}
        prefetch={prefetch}
        onClick={(e) => {
          e.preventDefault();
          startTransition(() => {
            router.push(href);
          });
        }}
        className={className}
      >
        {children}
      </Link>
      {isPending && <NavigationOverlay />}
    </>
  );
}

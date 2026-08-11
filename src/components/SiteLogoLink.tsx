'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import NavigationOverlay from './NavigationOverlay';

/**
 * Лого/название сайта в шапке — есть на КАЖДОЙ странице (Navbar), ведёт на
 * главную. Тот же приём, что и у ModeSwitch: полноэкранный лоадер на время
 * перехода вместо того, чтобы оставлять старую страницу кликабельной, пока
 * грузится новая.
 */
export default function SiteLogoLink() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const alreadyHome = pathname === '/' && searchParams.toString() === '';

  return (
    <>
      <Link
        href="/"
        onClick={(e) => {
          if (alreadyHome) return;
          e.preventDefault();
          startTransition(() => {
            router.push('/');
          });
        }}
        className="flex shrink-0 items-center gap-2 text-lg font-bold"
      >
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-white">
          ▶
        </span>
        <span className="hidden sm:inline">MediaWatch</span>
      </Link>

      {isPending && <NavigationOverlay />}
    </>
  );
}

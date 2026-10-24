'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FeedbackSection } from '@/lib/feedback';

/**
 * Один раз на раздел: «раздел новый, может работать нестабильно — напишите
 * нам, если что-то пойдёт не так» (24.10.2026). Новые разделы — подкасты,
 * аудиокниги, книги, ранобэ, манга; аниме и кино обкатаны давно.
 *
 * «Один раз» — копией в браузере (localStorage): плашка — предупреждение, а
 * не настройка, и показать её ещё раз на другом устройстве не страшно.
 * Хранилище недоступно (приватный режим) — не показываем вовсе, а не
 * показываем на каждом заходе.
 *
 * «Написать нам» ведёт в профиль на вкладку обратной связи с уже выбранным
 * разделом (?section=).
 */
const SECTIONS: { path: string; section: FeedbackSection; name: string }[] = [
  { path: '/podcasts', section: 'podcasts', name: 'Подкасты' },
  { path: '/audiobooks', section: 'audiobooks', name: 'Аудиокниги' },
  { path: '/books', section: 'books', name: 'Книги' },
  { path: '/ranobe', section: 'ranobe', name: 'Ранобэ' },
  { path: '/manga', section: 'manga', name: 'Манга' },
];

const KEY_PREFIX = 'mw:new-section-notice:';

export default function NewSectionNotice() {
  const pathname = usePathname();
  const [shown, setShown] = useState<(typeof SECTIONS)[number] | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const match = SECTIONS.find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`));
    if (!match) return;
    try {
      const key = `${KEY_PREFIX}${match.section}`;
      if (window.localStorage.getItem(key)) return;
      // Отмечаем сразу при показе: «один раз» — даже если плашку не закрыли,
      // а просто ушли со страницы.
      window.localStorage.setItem(key, new Date().toISOString());
      setShown(match);
    } catch {
      // Хранилища нет — не показываем, иначе плашка была бы на каждом заходе.
    }
  }, [pathname]);

  useEffect(() => {
    if (!shown) return;
    okRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShown(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);

  if (!shown) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center"
      onClick={() => setShown(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-section-title"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 rounded-3xl bg-bg-card p-5 shadow-2xl ring-1 ring-white/10"
      >
        <span className="w-fit rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/30">
          Новый раздел
        </span>
        <h2 id="new-section-title" className="text-lg font-bold">
          «{shown.name}» только появились
        </h2>
        <p className="text-sm leading-relaxed text-gray-300">
          Раздел новый и пока может работать нестабильно: что-то не откроется, загрузится не сразу или
          найдётся не всё. Мы будем рады, если вы напишете нам, когда что-то пойдёт не так, — это можно
          сделать в профиле, во вкладке «Обратная связь».
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            ref={okRef}
            type="button"
            onClick={() => setShown(null)}
            className="press rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg"
          >
            Понятно
          </button>
          <Link
            href={`/profile?tab=feedback&section=${shown.section}`}
            onClick={() => setShown(null)}
            className="press rounded-full px-4 py-2 text-sm text-gray-200 ring-1 ring-white/15 hover:text-white"
          >
            Написать нам
          </Link>
        </div>
      </div>
    </div>
  );
}

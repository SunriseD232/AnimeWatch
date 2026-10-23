'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { BookSource } from '@/lib/bookShared';
import { saveReadingProgress } from '@/lib/readingProgress';

/**
 * FB2-читатель — запасной путь, когда EPUB не открылся.
 *
 * Текст уже собран на сервере в HTML (lib/fb2.ts), здесь только показ и
 * прогресс. Постраничной навигации, как у epub.js, нет — это прокрутка, и
 * позиция считается долей прокрутки. Поэтому в locator уходит не CFI, а
 * scrollPercent: точность ниже, зато работает без разбора EPUB.
 *
 * HTML приходит только из нашего парсера (не пользовательский ввод), но
 * всё равно вставляется через dangerouslySetInnerHTML — разметка в нём
 * собирается из экранированного текста, см. escapeHtml в lib/fb2.ts.
 */
export default function Fb2Reader({
  id,
  title,
  coverUrl,
  source,
  html,
  annotation,
  chapters,
  initialPercent,
}: {
  id: number;
  title: string;
  coverUrl: string | null;
  source: BookSource;
  html: string;
  annotation: string | null;
  chapters: { href: string; title: string; depth: number }[];
  initialPercent: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const percentRef = useRef(initialPercent);

  const [percent, setPercent] = useState(initialPercent);
  const [tocOpen, setTocOpen] = useState(false);

  // Восстановление позиции — после первой отрисовки, когда scrollHeight уже
  // известен. smooth здесь не нужен: это не переход, а возврат на место.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || initialPercent <= 0) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) el.scrollTop = max * Math.min(1, initialPercent);
  }, [initialPercent]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const value = max > 0 ? Math.max(0, Math.min(1, el.scrollTop / max)) : 0;
      percentRef.current = value;
      setPercent(value);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        saveReadingProgress({
          id,
          title,
          coverUrl,
          source,
          percent: percentRef.current,
          locator: { scrollPercent: percentRef.current },
        });
      }, 2000);
    };

    el.addEventListener('scroll', onScroll, { passive: true });

    // Закрытие вкладки не размонтирует React-компонент, поэтому позицию надо
    // дописать отдельно. keepalive внутри saveReadingProgress позволяет
    // запросу пережить выгрузку страницы.
    const flush = () => {
      saveReadingProgress({
        id,
        title,
        coverUrl,
        source,
        percent: percentRef.current,
        locator: { scrollPercent: percentRef.current },
      });
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveReadingProgress({
        id,
        title,
        coverUrl,
        source,
        percent: percentRef.current,
        locator: { scrollPercent: percentRef.current },
      });
    };
  }, [id, title, coverUrl, source]);

  const percentLabel = Math.round(percent * 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Link
          href={`/books/${id}`}
          className="press shrink-0 rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
        >
          ← К книге
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-xs text-gray-400">
            FB2 · {percentLabel}% прочитано
          </p>
        </div>
        {chapters.length > 0 ? (
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            aria-expanded={tocOpen}
            className="press shrink-0 rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
          >
            Оглавление
          </button>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5">
        {tocOpen ? (
          <div className="absolute inset-y-0 left-0 z-20 flex w-72 max-w-[85%] flex-col border-r border-white/10 bg-bg-card/95 backdrop-blur">
            <div className="flex items-center justify-between p-3">
              <h2 className="text-sm font-semibold">Оглавление</h2>
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                aria-label="Закрыть оглавление"
                className="press rounded-full px-2 py-1 text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <ol className="flex-1 overflow-y-auto pb-4">
              {chapters.map((chapter, i) => (
                <li key={`${chapter.href}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      const target = chapter.href.startsWith('#')
                        ? document.getElementById(chapter.href.slice(1))
                        : null;
                      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      setTocOpen(false);
                    }}
                    style={{ paddingLeft: `${12 + chapter.depth * 12}px` }}
                    className="block w-full py-2 pr-3 text-left text-sm text-gray-300 transition hover:bg-bg-soft hover:text-white"
                  >
                    {chapter.title}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="fb2-scroll h-[calc(100dvh-11rem)] min-h-[420px] overflow-y-auto px-4 py-6 sm:px-8"
        >
          <div className="mx-auto max-w-3xl">
            {annotation ? (
              <div
                className="fb2-content mb-8 rounded-2xl bg-white/5 p-4 text-sm text-gray-300"
                dangerouslySetInnerHTML={{ __html: annotation }}
              />
            ) : null}
            <div className="fb2-content" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-gray-500">
        {percentLabel}% · Иллюстрации в FB2-версии не показываются
      </p>
    </div>
  );
}

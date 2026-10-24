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
  initialTextFraction = null,
}: {
  id: number;
  title: string;
  coverUrl: string | null;
  source: BookSource;
  html: string;
  annotation: string | null;
  chapters: { href: string; title: string; depth: number }[];
  initialPercent: number;
  /** Открыть с доли текста (место из аудиокниги, lib/syncOffers.ts) — точнее
   *  доли прокрутки: картинки и заголовки её искажают. */
  initialTextFraction?: number | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const percentRef = useRef(initialPercent);

  const [percent, setPercent] = useState(initialPercent);
  const [tocOpen, setTocOpen] = useState(false);

  // Восстановление позиции — после первой отрисовки, когда scrollHeight уже
  // известен. smooth здесь не нужен: это не переход, а возврат на место.
  // Доля текста (из аудиокниги) главнее доли прокрутки.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (initialTextFraction != null && contentRef.current) {
      scrollToTextFraction(el, contentRef.current, initialTextFraction);
      return;
    }
    if (initialPercent <= 0) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) el.scrollTop = max * Math.min(1, initialPercent);
  }, [initialPercent, initialTextFraction]);

  /** Что уходит в прогресс: доля текста до первой видимой строки — общая
   *  единица с EPUB и аудиокнигой (lib/bookAudioSync.ts) — и доля прокрутки
   *  для старых записей. */
  const snapshot = () => {
    const el = scrollRef.current;
    const content = contentRef.current;
    const textFraction = el && content ? textFractionAtScroll(el, content) : null;
    return {
      percent: textFraction ?? percentRef.current,
      locator: {
        scrollPercent: percentRef.current,
        ...(textFraction != null ? { textFraction } : {}),
      },
    };
  };
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

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
        saveReadingProgress({ id, title, coverUrl, source, ...snapshotRef.current() });
      }, 2000);
    };

    el.addEventListener('scroll', onScroll, { passive: true });

    // Закрытие вкладки не размонтирует React-компонент, поэтому позицию надо
    // дописать отдельно. keepalive внутри saveReadingProgress позволяет
    // запросу пережить выгрузку страницы.
    const flush = () => {
      saveReadingProgress({ id, title, coverUrl, source, ...snapshotRef.current() });
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveReadingProgress({ id, title, coverUrl, source, ...snapshotRef.current() });
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
            <div ref={contentRef} className="fb2-content" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-gray-500">
        {percentLabel}% · Иллюстрации в FB2-версии не показываются
      </p>
    </div>
  );
}

// ───────────── Доля текста ↔ прокрутка (синхронизация с аудиокнигой) ─────────────

/** Текстовые узлы книги с накопленной длиной до каждого. Пробелы схлопнуты,
 *  как и в серверной карте текста (lib/bookTextMap.ts), — иначе доли
 *  разъехались бы на отступах разметки. */
function textIndex(content: HTMLElement): { nodes: Text[]; starts: number[]; total: number } {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node.textContent ?? '').replace(/\s+/g, ' ').length;
    if (length === 0) continue;
    nodes.push(node as Text);
    starts.push(total);
    total += length;
  }
  return { nodes, starts, total };
}

function nodeTop(node: Text): number {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getBoundingClientRect().top;
}

/** Доля текста до первой строки, видимой сверху. Двоичный поиск: книга —
 *  десятки тысяч узлов, мерить каждый на каждой прокрутке дорого. */
function textFractionAtScroll(scroller: HTMLElement, content: HTMLElement): number | null {
  const { nodes, starts, total } = textIndex(content);
  if (total === 0) return null;
  const top = scroller.getBoundingClientRect().top;
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nodeTop(nodes[mid]) < top) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, Math.min(1, starts[lo] / total));
}

function scrollToTextFraction(scroller: HTMLElement, content: HTMLElement, fraction: number): void {
  const { nodes, starts, total } = textIndex(content);
  if (total === 0) return;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const delta = nodeTop(nodes[lo]) - scroller.getBoundingClientRect().top;
  // Строка чуть ниже верхнего края: так видно и предыдущую фразу.
  scroller.scrollTop += delta - 48;
}

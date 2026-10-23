/* eslint-disable @next/next/no-img-element */
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatMangaChapterLabel,
  mangaChapterShortLabel,
  mangaReadHref,
  mangaTitleHref,
  type MangaChapter,
  type MangaChapterContent,
} from '@/lib/mangaShared';
import { saveReadingProgress } from '@/lib/readingProgress';
import { sourceTitleLabel } from '@/lib/sources/chapterLabel';
import type { SourceId } from '@/lib/sources/types';

/**
 * Читатель манги: вертикальная лента страниц, оглавление, сохранение места.
 *
 * Страницы приходят с сервера уже подписанными через /api/proxy/raw
 * (см. lib/manga.ts), поэтому здесь только показ. Позиция — не CFI, как у
 * EPUB, а номер главы + доля прокрутки: главы у Remanga независимы, и
 * восстанавливать «место в книге» между ними бессмысленно.
 *
 * В progress уходит:
 *   • episode/chapterIndex — номер главы в оглавлении;
 *   • progress_percent — ОБЩИЙ процент по тайтлу, чтобы «продолжить» и
 *     карточка показывали одно число;
 *   • locator.scrollPercent — место внутри главы для восстановления;
 *   • locator.page — оценка страницы по прокрутке (для подписи).
 *
 * Платные главы Remanga не отдают страницы без покупки: сервер не делает
 * запрос, а читатель показывает заглушку. Обхода нет и быть не может.
 */
export default function MangaReader({
  titleId,
  dir,
  title,
  coverUrl,
  chapter,
  chapterIndex,
  chapters,
  chaptersCount,
  initialScrollPercent,
  source = 'remanga',
  chapterKey,
}: {
  titleId: number;
  dir: string;
  title: string;
  coverUrl: string | null;
  chapter: MangaChapterContent;
  /** Номер главы в оглавлении (1..N), даже если API не отдал index. */
  chapterIndex: number;
  chapters: MangaChapter[];
  chaptersCount: number;
  initialScrollPercent: number;
  /** Источник, из которого реально пришли страницы (remanga/mangadex/…). */
  source?: SourceId;
  /** id главы у источника: int/uuid/slug. Нужен для восстановления позиции. */
  chapterKey?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const percentRef = useRef(Math.max(0, Math.min(1, initialScrollPercent)));
  const [percent, setPercent] = useState(percentRef.current);
  const [tocOpen, setTocOpen] = useState(false);

  const safeCount = Math.max(1, chaptersCount);
  const safeIndex = Math.max(1, chapterIndex);
  const label = formatMangaChapterLabel(chapter);
  const pagesCount = chapter.pages.length;
  const resolvedChapterKey = chapterKey ?? String(chapter.id);
  const sourceName = sourceTitleLabel(source);

  // Общий прогресс: (главы до текущей + доля текущей) / всего глав.
  const overallPercent = Math.round(
    Math.max(0, Math.min(1, (safeIndex - 1 + percent) / safeCount)) * 100,
  );

  const persist = useCallback(
    (scrollPercent: number) => {
      if (!chapter.hasPages) return;
      const scroll = Math.max(0, Math.min(1, scrollPercent));
      const overall = Math.max(
        0,
        Math.min(1, (safeIndex - 1 + scroll) / safeCount),
      );

      saveReadingProgress({
        id: titleId,
        title,
        coverUrl,
        source,
        percent: overall,
        contentType: 'manga',
        unit: 'page',
        episode: safeIndex,
        locator: {
          source,
          chapterKey: resolvedChapterKey,
          idx: safeIndex,
          // Номер и том — устойчивые координаты: если в середину вставят
          // новую главу, idx сдвинется, а номер останется.
          chapterNo: chapter.number,
          tome: chapter.tome,
          dir,
          chapterId: chapter.id,
          chapterIndex: safeIndex,
          chapterLabel: label,
          page: pageAt(scroll, pagesCount),
          pagesCount,
          scrollPercent: scroll,
          chaptersCount: safeCount,
        },
      });
    },
    [
      chapter.hasPages,
      chapter.id,
      chapter.number,
      chapter.tome,
      coverUrl,
      dir,
      label,
      pagesCount,
      resolvedChapterKey,
      safeCount,
      safeIndex,
      source,
      title,
      titleId,
    ],
  );

  // Восстановление позиции — после первой отрисовки, когда scrollHeight уже
  // известен. Высоты картинок приходят с API и заданы атрибутами, поэтому
  // лента не прыгает после загрузки. Повторный вызов через 150 мс — на случай,
  // если браузер ещё не посчитал высоту.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const value = Math.max(0, Math.min(1, initialScrollPercent));
    if (value <= 0) return;

    const restore = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) el.scrollTop = max * value;
    };

    restore();
    const timer = setTimeout(restore, 150);
    return () => clearTimeout(timer);
  }, [initialScrollPercent, chapter.id]);

  useEffect(() => {
    if (!chapter.hasPages) return;
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
        persist(percentRef.current);
      }, 1500);
    };

    el.addEventListener('scroll', onScroll, { passive: true });

    // Открытие главы тоже считается позицией: иначе «продолжить» осталось бы
    // на предыдущей главе, пока человек не проскроллит новую.
    const initialSave = setTimeout(() => persist(percentRef.current), 1200);

    // Закрытие вкладки не размонтирует React-компонент, поэтому позицию надо
    // дописать отдельно. keepalive внутри saveReadingProgress позволяет
    // запросу пережить выгрузку страницы.
    const flush = () => persist(percentRef.current);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      clearTimeout(initialSave);
      persist(percentRef.current);
    };
  }, [chapter.hasPages, persist]);

  const currentPos = chapters.findIndex((c) => c.id === chapter.id);
  const prev = currentPos > 0 ? chapters[currentPos - 1] : null;
  const next =
    currentPos >= 0 && currentPos < chapters.length - 1
      ? chapters[currentPos + 1]
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Link
          href={mangaTitleHref(dir)}
          className="press shrink-0 rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
        >
          ← К манге
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-gray-400">
            {mangaChapterShortLabel(chapter)} · {overallPercent}% тайтла
            {source !== 'remanga' ? ` · ${sourceName}` : ''}
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
          <div className="absolute inset-y-0 left-0 z-20 flex w-80 max-w-[88%] flex-col border-r border-white/10 bg-bg-card/95 backdrop-blur">
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
              {chapters.map((c) => {
                const current = c.id === chapter.id;
                const itemClass = [
                  'block w-full px-3 py-2 text-left text-sm leading-snug transition',
                  current
                    ? 'bg-accent/15 font-semibold text-accent-text'
                    : 'text-gray-300 hover:bg-bg-soft hover:text-white',
                ].join(' ');

                if (!c.isReadable && !current) {
                  return (
                    <li key={c.id}>
                      <span
                        aria-disabled="true"
                        title="Платная глава: страницы недоступны без покупки у источника"
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm leading-snug text-gray-500"
                      >
                        <span className="line-clamp-2">{c.label}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {c.sourceLabels?.length ? (
                            <span className="text-[9px] uppercase tracking-wide text-gray-600">
                              {c.sourceLabels.join('·')}
                            </span>
                          ) : null}
                          <span
                            aria-hidden="true"
                            className="text-[10px] uppercase tracking-wide"
                          >
                            платно
                          </span>
                        </span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={c.id}>
                    <Link
                      href={mangaReadHref(dir, c.id)}
                      prefetch={false}
                      aria-current={current ? 'page' : undefined}
                      onClick={() => setTocOpen(false)}
                      className={itemClass}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="line-clamp-2">{c.label}</span>
                        {c.sourceLabels?.length ? (
                          <span className="shrink-0 text-[9px] uppercase tracking-wide text-gray-500">
                            {c.sourceLabels.join('·')}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="manga-scroll h-[calc(100dvh-11rem)] min-h-[420px] overflow-y-auto bg-black/20 px-2 py-3 sm:px-4 sm:py-4"
        >
          {chapter.hasPages ? (
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-1">
              {chapter.pages.map((page, i) => (
                <img
                  key={`${page.url}-${i}`}
                  src={page.url}
                  alt={`${title} — ${label}, страница ${i + 1}`}
                  width={page.width ?? undefined}
                  height={page.height ?? undefined}
                  loading={i < 3 ? 'eager' : 'lazy'}
                  decoding="async"
                  draggable={false}
                  className="block h-auto w-full select-none bg-bg-soft"
                />
              ))}
            </div>
          ) : (
            <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-white/5 p-6 text-center text-sm text-gray-300">
              <p className="font-semibold">
                {chapter.isPaid ? 'Платная глава' : 'Страницы главы недоступны'}
              </p>
              <p className="mt-2 text-gray-400">
                {chapter.isPaid
                  ? 'Источник не отдаёт страницы платной главы без покупки. Она показана в оглавлении, но прочитать её на сайте нельзя.'
                  : 'Источник не вернул страницы этой главы. Попробуйте открыть её позже или выберите другую.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {prev ? (
          <Link
            href={mangaReadHref(dir, prev.id)}
            prefetch={false}
            className="press min-w-0 flex-1 truncate rounded-xl bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
          >
            ← {prev.label}
            {prev.isReadable ? '' : ' · платно'}
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        {next ? (
          <Link
            href={mangaReadHref(dir, next.id)}
            prefetch={false}
            className="press min-w-0 flex-1 truncate rounded-xl bg-bg-card px-3 py-2 text-right text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
          >
            {next.label}
            {next.isReadable ? '' : ' · платно'} →
          </Link>
        ) : (
          <span className="flex-1" />
        )}
      </div>

      <p className="text-center text-xs text-gray-500">
        {chapter.hasPages
          ? `${Math.round(percent * 100)}% главы · стр. ${pageAt(percent, pagesCount)}/${pagesCount} · `
          : ''}
        {overallPercent}% тайтла. Место сохраняется автоматически.
      </p>
    </div>
  );
}

/** Оценка страницы 1..pagesCount по доле прокрутки. */
function pageAt(scroll: number, pagesCount: number): number {
  return pagesCount > 0
    ? Math.min(pagesCount, Math.max(1, Math.floor(scroll * pagesCount) + 1))
    : 1;
}

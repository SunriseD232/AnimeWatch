'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatRanobeChapterLabel,
  ranobeReadHref,
  ranobeTitleHref,
  ranobeChapterShortLabel,
  type RanobeChapter,
  type RanobeChapterContent,
} from '@/lib/ranobeShared';
import { saveReadingProgress } from '@/lib/readingProgress';

/**
 * Читатель ранобэ: одна глава, прокрутка, оглавление, сохранение места.
 *
 * Текст приходит с сервера уже очищенным (см. sanitizeRanobeHtml в
 * lib/ranobe.ts), поэтому здесь только показ. Позиция — не CFI, как у EPUB,
 * а номер главы + доля прокрутки: главы у Renovels независимы, и
 * восстанавливать «место в книге» между ними бессмысленно.
 *
 * В progress уходит:
 *   • episode/chapterIndex — номер главы в оглавлении;
 *   • progress_percent — ОБЩИЙ процент по тайтлу, чтобы «продолжить» и
 *     карточка показывали одно число;
 *   • locator.scrollPercent — место внутри главы для восстановления.
 */
export default function RanobeReader({
  titleId,
  dir,
  title,
  coverUrl,
  chapter,
  chapterIndex,
  chapters,
  chaptersCount,
  initialScrollPercent,
}: {
  titleId: number;
  dir: string;
  title: string;
  coverUrl: string | null;
  chapter: RanobeChapterContent;
  /** Номер главы в оглавлении (1..N), даже если API не отдал index. */
  chapterIndex: number;
  chapters: RanobeChapter[];
  chaptersCount: number;
  initialScrollPercent: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const percentRef = useRef(
    Math.max(0, Math.min(1, initialScrollPercent)),
  );
  const [percent, setPercent] = useState(percentRef.current);
  const [tocOpen, setTocOpen] = useState(false);

  const safeCount = Math.max(1, chaptersCount);
  const safeIndex = Math.max(1, chapterIndex);
  const label = formatRanobeChapterLabel(chapter);

  // Общий прогресс: (главы до текущей + доля текущей) / всего глав.
  const overallPercent = Math.round(
    Math.max(0, Math.min(1, (safeIndex - 1 + percent) / safeCount)) * 100,
  );

  const persist = useCallback(
    (scrollPercent: number) => {
      if (!chapter.hasContent) return;
      const scroll = Math.max(0, Math.min(1, scrollPercent));
      const overall = Math.max(
        0,
        Math.min(1, (safeIndex - 1 + scroll) / safeCount),
      );

      saveReadingProgress({
        id: titleId,
        title,
        coverUrl,
        source: 'renovels',
        percent: overall,
        contentType: 'ranobe',
        unit: 'chapter',
        episode: safeIndex,
        locator: {
          dir,
          chapterId: chapter.id,
          chapterIndex: safeIndex,
          chapterLabel: label,
          scrollPercent: scroll,
          chaptersCount: safeCount,
        },
      });
    },
    [
      chapter.hasContent,
      chapter.id,
      coverUrl,
      dir,
      label,
      safeCount,
      safeIndex,
      title,
      titleId,
    ],
  );

  // Восстановление позиции — после первой отрисовки, когда scrollHeight уже
  // известен. smooth здесь не нужен: это не переход, а возврат на место.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || initialScrollPercent <= 0) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) el.scrollTop = max * Math.max(0, Math.min(1, initialScrollPercent));
  }, [initialScrollPercent]);

  useEffect(() => {
    if (!chapter.hasContent) return;
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
  }, [chapter.hasContent, persist]);

  // Соседи: сначала из ответа главы, затем — по оглавлению. Ответ надёжнее:
  // в нём есть id даже для главы, выпавшей из текущей страницы списка.
  const currentPos = chapters.findIndex((c) => c.id === chapter.id);
  const prev =
    chapter.previous ??
    (currentPos > 0 ? chapterToRef(chapters[currentPos - 1]) : null);
  const next =
    chapter.next ??
    (currentPos >= 0 && currentPos < chapters.length - 1
      ? chapterToRef(chapters[currentPos + 1])
      : null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Link
          href={ranobeTitleHref(dir)}
          className="press shrink-0 rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
        >
          ← К ранобэ
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-gray-400">
            {ranobeChapterShortLabel(chapter)} · {overallPercent}% тайтла
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

                if (c.isPaid && !current) {
                  return (
                    <li key={c.id}>
                      <span
                        aria-disabled="true"
                        title="Платная глава: текст недоступен без покупки у источника"
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm leading-snug text-gray-500"
                      >
                        <span className="line-clamp-2">{c.label}</span>
                        <span aria-hidden="true" className="shrink-0 text-[10px] uppercase tracking-wide">
                          платно
                        </span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={c.id}>
                    <Link
                      href={ranobeReadHref(dir, c.id)}
                      prefetch={false}
                      aria-current={current ? 'page' : undefined}
                      onClick={() => setTocOpen(false)}
                      className={itemClass}
                    >
                      {c.label}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="ranobe-scroll h-[calc(100dvh-11rem)] min-h-[420px] overflow-y-auto px-4 py-6 sm:px-8"
        >
          <div className="mx-auto max-w-3xl">
            <h1 className="mb-6 text-lg font-bold leading-snug text-gray-100">
              {label}
            </h1>

            {chapter.hasContent ? (
              <div
                className="ranobe-content"
                // HTML очищен sanitize-html на сервере (lib/ranobe.ts):
                // разрешён только безопасный набор тегов и атрибутов.
                dangerouslySetInnerHTML={{ __html: chapter.html }}
              />
            ) : (
              <div className="rounded-2xl bg-white/5 p-6 text-center text-sm text-gray-300">
                <p className="font-semibold">
                  {chapter.isPaid ? 'Платная глава' : 'Текст главы недоступен'}
                </p>
                <p className="mt-2 text-gray-400">
                  {chapter.isPaid
                    ? 'Renovels не отдаёт текст платной главы без покупки. Она показана в оглавлении, но прочитать её на сайте нельзя.'
                    : 'Источник не вернул текст этой главы. Попробуйте открыть её позже или выберите другую.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {prev ? (
          <Link
            href={ranobeReadHref(dir, prev.id)}
            prefetch={false}
            className="press min-w-0 flex-1 truncate rounded-xl bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
          >
            ← {refLabel(prev)}
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        {next ? (
          <Link
            href={ranobeReadHref(dir, next.id)}
            prefetch={false}
            className="press min-w-0 flex-1 truncate rounded-xl bg-bg-card px-3 py-2 text-right text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
          >
            {refLabel(next)} →
          </Link>
        ) : (
          <span className="flex-1" />
        )}
      </div>

      <p className="text-center text-xs text-gray-500">
        {chapter.hasContent ? `${Math.round(percent * 100)}% главы · ` : ''}
        {overallPercent}% тайтла. Место сохраняется автоматически.
      </p>
    </div>
  );
}

function chapterToRef(chapter: RanobeChapter) {
  return {
    id: chapter.id,
    index: chapter.index,
    tome: chapter.tome,
    number: chapter.number,
    isPaid: chapter.isPaid,
  };
}

/** Подпись соседней главы: у RanobeChapterRef нет name, только номер. */
function refLabel(ref: { tome: number; number: string }): string {
  const number = ref.number.trim();
  const base = !number || number === '0' ? 'Пролог' : `Глава ${number}`;
  return ref.tome > 1 ? `Том ${ref.tome}, ${base}` : base;
}

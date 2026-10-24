/* eslint-disable @next/next/no-img-element */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
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
import { tapActionAt, type MangaReaderSettings, type TapAction } from '@/lib/mangaReaderSettings';
import ReaderSettingsPanel from '@/components/manga/ReaderSettingsPanel';
import { useMangaReaderSettings } from '@/components/manga/useMangaReaderSettings';
import {
  ListIcon,
  MaximizeIcon,
  MinimizeIcon,
  SettingsIcon,
  XIcon,
} from '@/components/social/icons';

/** Доля экрана, на которую листает «вперёд/назад» в ленте: чуть меньше
 *  экрана, чтобы последняя строка реплик осталась перед глазами. */
const SCREEN_STEP = 0.85;
/** Свайп короче этого — не свайп, а нажатие. */
const SWIPE_MIN_PX = 50;

/**
 * Читатель манги: три режима (по странице / лента / полоса), настройки как у
 * MangaLib (см. lib/mangaReaderSettings.ts), оглавление, сохранение места.
 *
 * Страницы приходят с сервера уже подписанными через /api/proxy/raw
 * (см. lib/manga.ts), поэтому здесь только показ. Позиция — не CFI, как у
 * EPUB, а номер главы + доля главы: главы у источников независимы, и
 * восстанавливать «место в книге» между ними бессмысленно.
 *
 * В progress уходит:
 *   • episode/chapterIndex — номер главы в оглавлении;
 *   • progress_percent — ОБЩИЙ процент по тайтлу, чтобы «продолжить» и
 *     карточка показывали одно число;
 *   • locator.scrollPercent — место внутри главы для восстановления. В
 *     ленте это доля прокрутки, по страницам — номер страницы / (страниц−1):
 *     одно число на оба режима, и переключение режима не теряет место;
 *   • locator.page — номер страницы (для подписи).
 *
 * Платные главы источника не отдают страницы без покупки: сервер не делает
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
  readerSettings = null,
  signedIn = false,
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
  /** Настройки из профиля (миграция 0062); null — не настраивались. */
  readerSettings?: MangaReaderSettings | null;
  signedIn?: boolean;
}) {
  const router = useRouter();
  const { settings, update, reset } = useMangaReaderSettings(readerSettings, signedIn);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRef = useRef<{ x: number; y: number; swiped: boolean } | null>(null);
  const percentRef = useRef(Math.max(0, Math.min(1, initialScrollPercent)));
  const [percent, setPercent] = useState(percentRef.current);
  const [panel, setPanel] = useState<'none' | 'toc' | 'settings'>('none');
  const [immersive, setImmersive] = useState(false);
  const [toolbarShown, setToolbarShown] = useState(true);
  const [wide, setWide] = useState(false);

  const safeCount = Math.max(1, chaptersCount);
  const safeIndex = Math.max(1, chapterIndex);
  const label = formatMangaChapterLabel(chapter);
  const pagesCount = chapter.pages.length;
  const resolvedChapterKey = chapterKey ?? String(chapter.id);
  const sourceName = sourceTitleLabel(source);

  const paged = settings.mode === 'paged';
  // Разворот — только на широком экране: на телефоне две страницы рядом
  // нечитаемо мелкие.
  const step = paged && settings.doublePage && wide ? 2 : 1;
  const [pageIdx, setPageIdx] = useState(() =>
    pagesCount > 1 ? Math.round(percentRef.current * (pagesCount - 1)) : 0,
  );

  // Общий прогресс: (главы до текущей + доля текущей) / всего глав.
  const overallPercent = Math.round(
    Math.max(0, Math.min(1, (safeIndex - 1 + percent) / safeCount)) * 100,
  );

  const currentPos = chapters.findIndex((c) => c.id === chapter.id);
  const prev = currentPos > 0 ? chapters[currentPos - 1] : null;
  const next =
    currentPos >= 0 && currentPos < chapters.length - 1
      ? chapters[currentPos + 1]
      : null;

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

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

  /** Новое место в главе: в состояние сразу, в прогресс — через паузу. */
  const track = useCallback(
    (value: number) => {
      percentRef.current = value;
      setPercent(value);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        persist(percentRef.current);
      }, 1500);
    },
    [persist],
  );

  // Сохранение при открытии и уходе — для всех режимов.
  useEffect(() => {
    if (!chapter.hasPages) return;
    // Открытие главы тоже считается позицией: иначе «продолжить» осталось бы
    // на предыдущей главе, пока человек не долистает новую.
    const initialSave = setTimeout(() => persist(percentRef.current), 1200);

    // Закрытие вкладки не размонтирует React-компонент, поэтому позицию надо
    // дописать отдельно. keepalive внутри saveReadingProgress позволяет
    // запросу пережить выгрузку страницы.
    const flush = () => persist(percentRef.current);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);

    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      clearTimeout(initialSave);
      persist(percentRef.current);
    };
  }, [chapter.hasPages, persist]);

  // ── Лента: восстановление места и учёт прокрутки ──
  //
  // Восстановление — после первой отрисовки, когда scrollHeight уже известен.
  // Высоты картинок приходят с API и заданы атрибутами, поэтому лента не
  // прыгает после загрузки. Повтор через 150 мс — на случай, если браузер ещё
  // не посчитал высоту. Срабатывает и при переключении из режима «по
  // странице»: место переносится через ту же долю.
  useEffect(() => {
    if (paged) return;
    const el = scrollRef.current;
    if (!el) return;
    const value = percentRef.current;
    if (value <= 0) return;
    const restore = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) el.scrollTop = max * value;
    };
    restore();
    const timer = setTimeout(restore, 150);
    return () => clearTimeout(timer);
  }, [paged, chapter.id]);

  useEffect(() => {
    if (paged || !chapter.hasPages) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      track(max > 0 ? Math.max(0, Math.min(1, el.scrollTop / max)) : 0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [paged, chapter.hasPages, track]);

  // ── По странице: номер страницы ↔ доля главы ──
  useEffect(() => {
    if (!paged) return;
    // Из ленты в «по странице» — страница по сохранённой доле.
    setPageIdx(pagesCount > 1 ? Math.round(percentRef.current * (pagesCount - 1)) : 0);
  }, [paged, pagesCount]);

  useEffect(() => {
    if (!paged || !chapter.hasPages) return;
    // Разворот начинается с чётной страницы: пары не «съезжают» при листании.
    if (step === 2 && pageIdx % 2 === 1) {
      setPageIdx(pageIdx - 1);
      return;
    }
    const lastShown = Math.min(pagesCount - 1, pageIdx + step - 1);
    track(pagesCount > 1 ? lastShown / (pagesCount - 1) : 1);
    scrollRef.current?.scrollTo({ top: 0 });
    // Следующие страницы — заранее, чтобы листание не ждало сети.
    for (let i = pageIdx + step; i < Math.min(pagesCount, pageIdx + step * 3); i++) {
      const img = new Image();
      img.decoding = 'async';
      img.src = chapter.pages[i].url;
    }
  }, [paged, pageIdx, step, pagesCount, chapter.hasPages, chapter.pages, track]);

  // ── Полный экран ──
  const exitImmersive = useCallback(() => {
    setImmersive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const toggleImmersive = useCallback(() => {
    if (immersive) {
      exitImmersive();
      return;
    }
    setImmersive(true);
    setToolbarShown(true);
    // Настоящий полноэкранный режим — где браузер даёт (на iPhone для
    // обычных элементов его нет). Без него читалка всё равно закрывает
    // собой страницу сайта: шапка и нижняя панель не мешают.
    rootRef.current?.requestFullscreen?.().catch(() => {});
  }, [immersive, exitImmersive]);

  useEffect(() => {
    // Вышли из полного экрана клавишей браузера (Esc, F11) — выходим и
    // из режима читалки, иначе он остался бы «наполовину».
    const onChange = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    // Страница под читалкой не должна прокручиваться вместе с ней.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [immersive]);

  // ── Навигация ──
  const hideToolbarOnRead = useCallback(() => {
    if (immersive && settings.autoHideToolbar) setToolbarShown(false);
  }, [immersive, settings.autoHideToolbar]);

  const openChapter = useCallback(
    (target: MangaChapter | null) => {
      if (!target || !target.isReadable) return false;
      persist(percentRef.current);
      router.push(mangaReadHref(dir, target.id));
      return true;
    },
    [dir, persist, router],
  );

  const goNext = useCallback(() => {
    hideToolbarOnRead();
    if (paged) {
      if (pageIdx + step < pagesCount) setPageIdx(pageIdx + step);
      else if (settings.autoNextChapter) openChapter(next);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollTop >= el.scrollHeight - el.clientHeight - 4;
    if (atEnd) {
      if (settings.autoNextChapter) openChapter(next);
      return;
    }
    el.scrollBy({ top: el.clientHeight * SCREEN_STEP, behavior: 'smooth' });
  }, [hideToolbarOnRead, paged, pageIdx, step, pagesCount, settings.autoNextChapter, openChapter, next]);

  const goPrev = useCallback(() => {
    hideToolbarOnRead();
    if (paged) {
      if (pageIdx > 0) setPageIdx(Math.max(0, pageIdx - step));
      else if (settings.autoNextChapter) openChapter(prev);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 4) {
      if (settings.autoNextChapter) openChapter(prev);
      return;
    }
    el.scrollBy({ top: -el.clientHeight * SCREEN_STEP, behavior: 'smooth' });
  }, [hideToolbarOnRead, paged, pageIdx, step, settings.autoNextChapter, openChapter, prev]);

  /** На экран вниз внутри длинной страницы, а у её конца — следующая. */
  const screenForward = useCallback(() => {
    const el = scrollRef.current;
    if (paged && el && el.scrollTop < el.scrollHeight - el.clientHeight - 4) {
      el.scrollBy({ top: el.clientHeight * SCREEN_STEP, behavior: 'smooth' });
      return;
    }
    goNext();
  }, [paged, goNext]);

  const screenBack = useCallback(() => {
    const el = scrollRef.current;
    if (paged && el && el.scrollTop > 4) {
      el.scrollBy({ top: -el.clientHeight * SCREEN_STEP, behavior: 'smooth' });
      return;
    }
    goPrev();
  }, [paged, goPrev]);

  const runAction = useCallback(
    (action: TapAction) => {
      if (panel !== 'none') {
        // Первое нажатие мимо открытой панели — только закрыть её.
        setPanel('none');
        return;
      }
      if (action === 'next') goNext();
      else if (action === 'prev') goPrev();
      else setToolbarShown((v) => !v);
    },
    [panel, goNext, goPrev],
  );

  const onTap = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (touchRef.current?.swiped) {
      touchRef.current = null;
      return;
    }
    if (!chapter.hasPages) return;
    const viewport = scrollRef.current?.getBoundingClientRect();
    if (!viewport) return;
    let area = viewport;
    if (settings.tapArea === 'image') {
      // Зоны считаются по видимой части страниц, а нажатие мимо них (поля
      // по бокам) — это «Меню», как у MangaLib.
      const column = columnRef.current?.getBoundingClientRect();
      if (!column) return;
      const left = Math.max(column.left, viewport.left);
      const right = Math.min(column.right, viewport.right);
      const top = Math.max(column.top, viewport.top);
      const bottom = Math.min(column.bottom, viewport.bottom);
      if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) {
        runAction('menu');
        return;
      }
      area = new DOMRect(left, top, right - left, bottom - top);
    }
    const fx = (e.clientX - area.left) / Math.max(1, area.width);
    const fy = (e.clientY - area.top) / Math.max(1, area.height);
    runAction(tapActionAt(settings.tapZones, settings.direction, fx, fy));
  };

  // Свайп — только в режиме «по странице»: в ленте горизонтальный жест
  // ничего не значит, а вертикальный — это прокрутка.
  const onTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, swiped: false };
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touchRef.current;
    const t = e.changedTouches[0];
    if (!paged || !start || !t || e.touches.length > 0) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    start.swiped = true;
    // Свайп влево — «к следующей» слева направо и «к предыдущей» справа налево.
    const forward = settings.direction === 'ltr' ? dx < 0 : dx > 0;
    if (forward) goNext();
    else goPrev();
  };

  // ── Горячие клавиши ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      // Пробел и Enter на кнопке — нажатие самой кнопки, не листание.
      if (target?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

      const rtl = paged && settings.direction === 'rtl';
      const el = scrollRef.current;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let handled = true;
      switch (key) {
        case 'ArrowRight':
        case 'd':
        case 'в':
          if (rtl) goPrev();
          else goNext();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'ф':
          if (rtl) goNext();
          else goPrev();
          break;
        case ' ':
          if (e.shiftKey) screenBack();
          else screenForward();
          break;
        case 'PageDown':
          screenForward();
          break;
        case 'PageUp':
          screenBack();
          break;
        case 'ArrowDown':
          el?.scrollBy({ top: 120 });
          break;
        case 'ArrowUp':
          el?.scrollBy({ top: -120 });
          break;
        case 'Home':
          if (paged) setPageIdx(0);
          else el?.scrollTo({ top: 0 });
          break;
        case 'End':
          if (paged) setPageIdx(Math.max(0, pagesCount - step));
          else el?.scrollTo({ top: el.scrollHeight });
          break;
        case ']':
        case 'ъ':
          openChapter(next);
          break;
        case '[':
        case 'х':
          openChapter(prev);
          break;
        case 'f':
        case 'а':
          toggleImmersive();
          break;
        case 's':
        case 'ы':
          setPanel((p) => (p === 'settings' ? 'none' : 'settings'));
          break;
        case 'c':
        case 'с':
          setPanel((p) => (p === 'toc' ? 'none' : 'toc'));
          break;
        case 'm':
        case 'ь':
          setToolbarShown((v) => !v);
          break;
        case 'Escape':
          if (panel !== 'none') setPanel('none');
          else if (immersive) exitImmersive();
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    paged,
    settings.direction,
    goNext,
    goPrev,
    screenForward,
    screenBack,
    pagesCount,
    step,
    openChapter,
    next,
    prev,
    toggleImmersive,
    exitImmersive,
    panel,
    immersive,
  ]);

  // ── Вид ──
  const viewportHeight = immersive ? '100dvh' : 'max(420px, calc(100dvh - 11rem))';
  const imageStyle = imageSizing(settings, viewportHeight, paged && step === 2);
  const pageGap = settings.mode === 'strip' ? 'gap-0' : 'gap-2';
  const themeClass =
    settings.theme === 'light'
      ? 'bg-neutral-100'
      : settings.theme === 'dark'
        ? 'bg-neutral-950'
        : 'bg-neutral-100 [@media(prefers-color-scheme:dark)]:bg-neutral-950';
  const toolbarVisible = !immersive || !settings.autoHideToolbar || toolbarShown || panel !== 'none';

  const shownPages = paged
    ? chapter.pages
        .slice(pageIdx, pageIdx + step)
        .map((page, i) => ({ page, index: pageIdx + i }))
    : chapter.pages.map((page, index) => ({ page, index }));
  if (paged && settings.direction === 'rtl') shownPages.reverse();

  const pageLabel = paged
    ? step === 2 && pageIdx + 1 < pagesCount
      ? `${pageIdx + 1}–${pageIdx + 2} / ${pagesCount}`
      : `${pageIdx + 1} / ${pagesCount}`
    : `${pageAt(percent, pagesCount)} / ${pagesCount}`;
  const currentPage = paged ? pageIdx : pageAt(percent, pagesCount) - 1;

  const jumpToPage = (index: number) => {
    if (paged) {
      setPageIdx(step === 2 ? index - (index % 2) : index);
      return;
    }
    const el = scrollRef.current;
    const img = columnRef.current?.children[index] as HTMLElement | undefined;
    if (el && img) el.scrollTo({ top: img.offsetTop - 8 });
  };

  const toolbar = (
    <div
      className={[
        'flex items-center gap-2',
        immersive
          ? 'absolute inset-x-0 top-0 z-20 bg-black/75 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur transition-opacity'
          : '',
        immersive && !toolbarVisible ? 'pointer-events-none opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <Link
        href={mangaTitleHref(dir)}
        className="press shrink-0 rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
      >
        ← <span className="hidden sm:inline">К манге</span>
      </Link>
      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-sm font-medium text-gray-100">{title}</p>
        <p className="truncate text-xs text-gray-400">
          {mangaChapterShortLabel(chapter)} · {overallPercent}% тайтла
          {source !== 'remanga' ? ` · ${sourceName}` : ''}
        </p>
      </div>
      {chapters.length > 0 ? (
        <ToolButton
          label="Оглавление"
          active={panel === 'toc'}
          onClick={() => setPanel((p) => (p === 'toc' ? 'none' : 'toc'))}
        >
          <ListIcon className="h-4 w-4" />
        </ToolButton>
      ) : null}
      <ToolButton
        label="Настройки"
        active={panel === 'settings'}
        onClick={() => setPanel((p) => (p === 'settings' ? 'none' : 'settings'))}
      >
        <SettingsIcon className="h-4 w-4" />
      </ToolButton>
      <ToolButton label={immersive ? 'Выйти из полного экрана' : 'Во весь экран'} onClick={toggleImmersive}>
        {immersive ? <MinimizeIcon className="h-4 w-4" /> : <MaximizeIcon className="h-4 w-4" />}
      </ToolButton>
    </div>
  );

  const chapterNav = (
    <div
      className={[
        'flex items-center justify-between gap-2',
        immersive
          ? 'absolute inset-x-0 bottom-0 z-20 bg-black/75 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur transition-opacity'
          : '',
        immersive && !toolbarVisible ? 'pointer-events-none opacity-0' : 'opacity-100',
      ].join(' ')}
    >
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
  );

  return (
    <div
      ref={rootRef}
      className={
        immersive
          ? 'fixed inset-0 z-[60] flex flex-col bg-black'
          : 'flex flex-col gap-2'
      }
    >
      {!immersive ? toolbar : null}

      <div
        className={[
          'relative overflow-hidden',
          immersive ? 'flex-1' : 'rounded-2xl ring-1 ring-inset ring-white/5',
          themeClass,
        ].join(' ')}
      >
        {immersive ? toolbar : null}

        {panel === 'toc' ? (
          <TableOfContents
            chapters={chapters}
            currentId={chapter.id}
            dir={dir}
            onClose={() => setPanel('none')}
          />
        ) : null}

        {panel === 'settings' ? (
          <ReaderSettingsPanel
            settings={settings}
            onChange={update}
            onReset={reset}
            onClose={() => setPanel('none')}
            signedIn={signedIn}
          />
        ) : null}

        <div
          ref={scrollRef}
          onClick={onTap}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{ height: viewportHeight }}
          className={[
            'manga-scroll select-none overflow-y-auto overscroll-contain',
            paged ? 'flex' : '',
            settings.mode === 'strip' ? 'py-0' : 'py-3 sm:py-4',
          ].join(' ')}
        >
          {chapter.hasPages ? (
            <div
              ref={columnRef}
              style={{
                width: `${settings.width}%`,
                filter: settings.brightness < 100 ? `brightness(${settings.brightness / 100})` : undefined,
              }}
              className={[
                'mx-auto flex px-1 sm:px-2',
                paged ? 'm-auto flex-row items-center justify-center gap-1' : `flex-col items-center ${pageGap}`,
              ].join(' ')}
            >
              {shownPages.map(({ page, index }) => (
                <img
                  key={`${page.url}-${index}`}
                  src={page.url}
                  alt={`${title} — ${label}, страница ${index + 1}`}
                  width={page.width ?? undefined}
                  height={page.height ?? undefined}
                  loading={paged || index < 3 ? 'eager' : 'lazy'}
                  decoding="async"
                  draggable={false}
                  style={imageStyle}
                  className="block select-none bg-white/5"
                />
              ))}
            </div>
          ) : (
            <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-bg-card p-6 text-center text-sm text-gray-300">
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

        {chapter.hasPages && settings.progressBar !== 'hidden' && pagesCount > 1 ? (
          <ProgressBar
            count={pagesCount}
            current={currentPage}
            size={settings.progressBar}
            position={settings.progressPosition}
            rtl={paged && settings.direction === 'rtl'}
            raised={immersive && toolbarVisible}
            onJump={jumpToPage}
          />
        ) : null}

        {chapter.hasPages && !settings.hidePageNumber ? (
          <span
            aria-live="polite"
            className={[
              'pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-xs tabular-nums text-white transition-[bottom]',
              immersive && toolbarVisible ? 'bottom-16' : 'bottom-3',
            ].join(' ')}
          >
            {pageLabel}
          </span>
        ) : null}

        {immersive ? chapterNav : null}
      </div>

      {!immersive ? (
        <>
          {chapterNav}
          <p className="text-center text-xs text-gray-500">
            {chapter.hasPages ? `${Math.round(percent * 100)}% главы · ` : ''}
            {overallPercent}% тайтла. Место сохраняется автоматически. Клавиши и зоны нажатия — в
            настройках.
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Размер страницы по настройкам «Вместить» и «Увеличение».
 *   • По ширине: страница во всю ширину колонки (с увеличением) или в свою
 *     родную ширину, но не шире колонки (без него).
 *   • По высоте экрана: страница целиком на экране — высота экрана (с
 *     увеличением) или не выше экрана (без него).
 * В развороте каждая страница — не шире половины колонки.
 */
function imageSizing(
  settings: MangaReaderSettings,
  viewportHeight: string,
  double: boolean,
): CSSProperties {
  // Отступы ленты сверху и снизу — чтобы «по высоте» страница не упиралась
  // в края впритык и не давала лишней прокрутки.
  const screen = settings.mode === 'strip' ? viewportHeight : `calc(${viewportHeight} - 2rem)`;
  const maxWidth = double ? '50%' : '100%';
  if (settings.fit === 'height') {
    return settings.upscale
      ? { height: screen, width: 'auto', maxWidth, objectFit: 'contain' }
      : { maxHeight: screen, width: 'auto', height: 'auto', maxWidth };
  }
  return settings.upscale
    ? { width: double ? '50%' : '100%', height: 'auto' }
    : { width: 'auto', height: 'auto', maxWidth };
}

function ToolButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={[
        'press grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-white/10 transition',
        active ? 'bg-accent text-accent-fg' : 'bg-bg-card text-gray-200 hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * Полоса прогресса из отрезков-страниц (как у MangaDex): видно, сколько
 * осталось, и нажатием на отрезок можно перейти на страницу.
 */
function ProgressBar({
  count,
  current,
  size,
  position,
  rtl,
  raised,
  onJump,
}: {
  count: number;
  current: number;
  size: 'thin' | 'normal';
  position: 'bottom' | 'left' | 'right';
  rtl: boolean;
  raised: boolean;
  onJump: (index: number) => void;
}) {
  const vertical = position !== 'bottom';
  const thickness = size === 'thin' ? (vertical ? 'w-1 hover:w-2.5' : 'h-1 hover:h-2.5') : vertical ? 'w-2.5' : 'h-2.5';
  const place =
    position === 'bottom'
      ? `inset-x-0 ${raised ? 'bottom-14' : 'bottom-0'}`
      : position === 'left'
        ? 'inset-y-0 left-0'
        : 'inset-y-0 right-0';
  return (
    <div
      className={[
        'group absolute z-10 flex gap-px transition-all',
        place,
        thickness,
        vertical ? 'flex-col' : rtl ? 'flex-row-reverse' : 'flex-row',
      ].join(' ')}
      // Нажатие по полосе — переход, а не зона «вперёд/назад» под ней.
      onClick={(e) => e.stopPropagation()}
    >
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          tabIndex={-1}
          aria-label={`Страница ${i + 1}`}
          onClick={() => onJump(i)}
          className={[
            'min-h-0 min-w-0 flex-1 transition-colors',
            i <= current ? 'bg-accent' : 'bg-white/25 hover:bg-white/50',
          ].join(' ')}
        />
      ))}
    </div>
  );
}

function TableOfContents({
  chapters,
  currentId,
  dir,
  onClose,
}: {
  chapters: MangaChapter[];
  currentId: number;
  dir: string;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-y-0 left-0 z-30 flex w-80 max-w-[88%] flex-col border-r border-white/10 bg-bg-card/95 text-gray-100 backdrop-blur"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between p-3">
        <h2 className="text-sm font-semibold">Оглавление</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть оглавление"
          className="press grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:text-white"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <ol className="flex-1 overflow-y-auto pb-4">
        {chapters.map((c) => {
          const current = c.id === currentId;
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
                    <span aria-hidden="true" className="text-[10px] uppercase tracking-wide">
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
                onClick={onClose}
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
  );
}

/** Оценка страницы 1..pagesCount по доле главы. */
function pageAt(scroll: number, pagesCount: number): number {
  return pagesCount > 0
    ? Math.min(pagesCount, Math.max(1, Math.floor(scroll * pagesCount) + 1))
    : 1;
}

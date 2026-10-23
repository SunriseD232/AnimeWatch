'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, Location, NavItem, Rendition } from 'epubjs';
import type { BookSource } from '@/lib/bookShared';
import { saveReadingProgress } from '@/lib/readingProgress';

/**
 * EPUB-читатель на epub.js.
 *
 * Почему epub.js. Флибуста отдаёт именно EPUB (конвертирует из fb2 на лету),
 * а epub.js — единственный зрелый браузерный движок, который даёт CFI:
 * точную, устойчивую к изменению вёрстки позицию внутри книги. Без CFI
 * «продолжить чтение» пришлось бы хранить номер страницы, а он зависит от
 * размера окна и шрифта — на телефоне и на десктопе это разные страницы.
 *
 * Почему динамический импорт. epub.js тянет jszip и весь разбор EPUB —
 * сотни килобайт. На странице каталога они не нужны: грузим модуль только
 * когда человек действительно открыл книгу (в useEffect, не на сервере).
 *
 * Почему файл идёт через наш /api/books/[id]/file, а не напрямую с
 * Флибусты. Браузер не увидит ни адреса источника, ни mixed content
 * (источник http, сайт https), ни возможных Referer-запретов. Файл целиком
 * (0,3–1,5 МБ) скачивается в память — epub.js и так работает с ним как с
 * zip-архивом.
 */

type ReaderTheme = 'dark' | 'sepia' | 'light';

const THEME_STORAGE_KEY = 'mw-reader-theme';

const THEMES: Record<ReaderTheme, Record<string, Record<string, string>>> = {
  dark: {
    body: { background: '#14161b', color: '#d9dce3' },
    'p, li, blockquote': { 'line-height': '1.65' },
    a: { color: '#8ab4f8' },
    '::selection': { background: '#3b4a68' },
  },
  sepia: {
    body: { background: '#f3ecdc', color: '#3d3324' },
    'p, li, blockquote': { 'line-height': '1.65' },
    a: { color: '#8a5a1f' },
    '::selection': { background: '#e2d3b3' },
  },
  light: {
    body: { background: '#ffffff', color: '#1b1d22' },
    'p, li, blockquote': { 'line-height': '1.65' },
    a: { color: '#1a56db' },
    '::selection': { background: '#dbeafe' },
  },
};

interface TocEntry {
  href: string;
  label: string;
  depth: number;
}

/** epub.js отдаёт дерево; нам для панели достаточно плоского списка. */
function flattenToc(items: NavItem[], depth = 0, out: TocEntry[] = []): TocEntry[] {
  for (const item of items) {
    const label = item.label?.trim();
    if (label) out.push({ href: item.href, label, depth });
    if (item.subitems?.length) flattenToc(item.subitems, depth + 1, out);
  }
  return out;
}

export default function BookReader({
  id,
  title,
  coverUrl,
  source,
  sourceUrl,
  fileUrl,
  fb2Href,
  initialCfi,
  initialPercent,
}: {
  id: number;
  title: string;
  coverUrl: string | null;
  source: BookSource;
  /** Страница книги у источника — запасной выход, если EPUB не открылся. */
  sourceUrl: string;
  fileUrl: string;
  /** Ссылка на FB2-читатель (запасной путь). */
  fb2Href: string;
  initialCfi: string | null;
  initialPercent: number | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Последнее известное место. Отдельный ref, а не state: обработчик выгрузки
  // страницы читает его синхронно, и к этому моменту state уже может быть
  // «на шаг позади».
  const positionRef = useRef<{ cfi: string; percent: number }>({
    cfi: initialCfi ?? '',
    percent: initialPercent ?? 0,
  });

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(initialPercent ?? 0);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [theme, setTheme] = useState<ReaderTheme>('dark');

  // Тема — из localStorage после монтирования: читать её в начальном
  // состоянии нельзя, сервер её не знает и разметка разошлась бы при
  // гидратации.
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'sepia' || stored === 'light') setTheme(stored);
  }, []);

  const persist = useCallback(
    (state: { cfi: string; percent: number }) => {
      if (!state.cfi) return;
      saveReadingProgress({
        id,
        title,
        coverUrl,
        source,
        percent: state.percent,
        locator: { cfi: state.cfi },
      });
    },
    [id, title, coverUrl, source],
  );

  /** Сохраняем не на каждое перелистывание: книга листается чаще, чем видео. */
  const queueSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      persist(positionRef.current);
    }, 2500);
  }, [persist]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const ePub = (await import('epubjs')).default;
        if (cancelled || !hostRef.current) return;

        // openAs: 'epub' обязателен. epub.js определяет тип по расширению в
        // пути, а наш адрес кончается на `/file?format=epub` — расширения там
        // нет, и без подсказки библиотека приняла бы адрес за каталог с OPF.
        const book = ePub(fileUrl, { openAs: 'epub' });
        bookRef.current = book;

        await book.ready;
        if (cancelled || !hostRef.current) return;

        const rendition = book.renderTo(hostRef.current, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: 'auto',
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        // Темы ставим до display: иначе книга успевает мигнуть белым фоном.
        // Тему читаем из localStorage прямо здесь, а не из состояния: эффект
        // с восстановлением темы мог уже отработать до создания rendition, и
        // тогда он ничего не применил бы, а замыкание держало бы дефолтную
        // тему с первого рендера.
        const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
        const initialTheme: ReaderTheme =
          storedTheme === 'sepia' || storedTheme === 'light' ? storedTheme : 'dark';
        for (const [name, rules] of Object.entries(THEMES)) {
          rendition.themes.register(name, rules);
        }
        rendition.themes.select(initialTheme);

        rendition.on('relocated', (location: Location) => {
          const cfi = location?.start?.cfi;
          if (!cfi) return;
          // Пока locations не построены, точный процент знает только сам
          // epub.js (start.percentage); после генерации он точнее.
          const fromLocations = book.locations.length()
            ? book.locations.percentageFromCfi(cfi)
            : location.start.percentage;
          // До генерации locations процент часто undefined. Тогда оставляем
          // прежнее значение, а не 0: иначе восстановление по CFI сразу же
          // записало бы «прочитано 0%» и затёрло сохранённое место.
          const value = Number.isFinite(fromLocations)
            ? fromLocations
            : positionRef.current.percent;
          positionRef.current = { cfi, percent: value };
          setPercent(value);
          queueSave();
        });

        // Клавиатура внутри iframe не всплывает в родительский документ —
        // вешаем обработчик на каждый отрендеренный раздел. WeakSet: epub.js
        // может эмитить `rendered` для того же документа повторно (ресайз,
        // возврат в раздел), и без защиты на одно нажатие приходилось бы
        // несколько перелистываний.
        const listenerDocs = new WeakSet<Document>();
        rendition.on('rendered', (_section: unknown, view: { document?: Document }) => {
          const doc = view.document;
          if (!doc || listenerDocs.has(doc)) return;
          listenerDocs.add(doc);
          doc.addEventListener('keyup', onKeyUp);
        });

        try {
          if (initialCfi) {
            await rendition.display(initialCfi);
          } else if (initialPercent && initialPercent > 0.001) {
            // CFI нет (книгу начали в FB2-читателе), но процент есть. Точную
            // позицию по проценту можно получить только из карты locations —
            // строим её сразу, иначе «продолжить» открыло бы первую страницу.
            await book.locations.generate(1200);
            const cfi = book.locations.cfiFromPercentage(
              Math.min(1, Math.max(0, initialPercent)),
            );
            if (cfi) await rendition.display(cfi);
            else await rendition.display();
          } else {
            await rendition.display();
          }
        } catch {
          // CFI от прошлого издания книги может не подойти — открываем
          // с начала, а не показываем ошибку.
          await rendition.display();
        }

        if (cancelled) return;
        setReady(true);

        const navigation = await book.loaded.navigation;
        if (!cancelled && navigation?.toc?.length) {
          setToc(flattenToc(navigation.toc));
        }

        // Генерация «страниц» нужна для точного процента. На больших книгах
        // это занимает секунды, поэтому не ждём её перед показом текста.
        // Если карту уже построили ради восстановления по проценту — не
        // запускаем второй раз.
        if (book.locations.length() === 0) {
          void book.locations
            .generate(1200)
            .then(() => {
              if (cancelled) return;
              const cfi = positionRef.current.cfi;
              if (!cfi) return;
              const value = book.locations.percentageFromCfi(cfi);
              if (Number.isFinite(value)) {
                positionRef.current = { cfi, percent: value };
                setPercent(value);
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[BookReader] не открыл EPUB:', err);
        setError('Не удалось открыть EPUB. Попробуйте FB2-версию — текст тот же.');
      }
    })();

    function onKeyUp(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        void renditionRef.current?.next();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        void renditionRef.current?.prev();
      }
    }

    // Клавиатура в родительском окне (когда фокус не в iframe).
    document.addEventListener('keyup', onKeyUp);

    return () => {
      cancelled = true;
      document.removeEventListener('keyup', onKeyUp);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Последняя позиция — на выходе. Сначала сохраняем, потом уничтожаем
      // движок: после destroy() CFI уже не прочитать.
      persist(positionRef.current);
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // initialCfi/fileUrl меняются только при переходе на другую книгу —
    // компонент перемонтируется ключом на странице.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // Смена темы на лету.
  useEffect(() => {
    renditionRef.current?.themes.select(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* приватный режим — тема просто не запомнится */
    }
  }, [theme]);

  // Сохраняем и при уходе со страницы: размонтирование компонента может не
  // случиться (закрыли вкладку), а beforeunload случится.
  useEffect(() => {
    const flush = () => persist(positionRef.current);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [persist]);

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
          <p className="text-xs text-gray-400">{percentLabel}% прочитано</p>
        </div>

        <button
          type="button"
          onClick={() => setTocOpen((v) => !v)}
          aria-expanded={tocOpen}
          className="press shrink-0 rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
        >
          Оглавление
        </button>
        <button
          type="button"
          onClick={() =>
            setTheme((t) => (t === 'dark' ? 'sepia' : t === 'sepia' ? 'light' : 'dark'))
          }
          title="Сменить тему чтения"
          className="press shrink-0 rounded-full bg-bg-card px-3 py-2 text-sm text-gray-200 ring-1 ring-white/10 hover:text-white"
        >
          {theme === 'dark' ? 'Тёмная' : theme === 'sepia' ? 'Сепия' : 'Светлая'}
        </button>
      </div>

      <div className="relative h-[calc(100dvh-11rem)] min-h-[420px] overflow-hidden rounded-2xl bg-bg-card ring-1 ring-inset ring-white/5">
        {!ready && !error ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-bg-card text-sm text-gray-400">
            Открываем книгу…
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-bg-card p-6 text-center">
            <div className="flex max-w-sm flex-col gap-3">
              <p className="text-sm text-gray-300">{error}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  href={fb2Href}
                  prefetch={false}
                  className="press rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg"
                >
                  Читать FB2
                </Link>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="press rounded-full bg-bg-soft px-4 py-2 text-sm ring-1 ring-white/10"
                >
                  Открыть на Флибусте
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {/* Контейнер, в который epub.js вставляет свой iframe. */}
        <div ref={hostRef} className="h-full w-full" />

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
              {toc.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-400">
                  Оглавление не найдено — листайте подряд.
                </li>
              ) : (
                toc.map((item, i) => (
                  <li key={`${item.href}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        void renditionRef.current?.display(item.href);
                        setTocOpen(false);
                      }}
                      style={{ paddingLeft: `${12 + item.depth * 12}px` }}
                      className="block w-full py-2 pr-3 text-left text-sm text-gray-300 transition hover:bg-bg-soft hover:text-white"
                    >
                      {item.label}
                    </button>
                  </li>
                ))
              )}
            </ol>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void renditionRef.current?.prev()}
          className="press rounded-full bg-bg-card px-5 py-2 text-sm ring-1 ring-white/10 hover:text-white"
        >
          ← Назад
        </button>
        <span className="text-xs text-gray-500">{percentLabel}%</span>
        <button
          type="button"
          onClick={() => void renditionRef.current?.next()}
          className="press rounded-full bg-bg-card px-5 py-2 text-sm ring-1 ring-white/10 hover:text-white"
        >
          Вперёд →
        </button>
      </div>
    </div>
  );
}

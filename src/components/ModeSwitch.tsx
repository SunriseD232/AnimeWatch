'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ContentType } from '@/lib/types';
import { MODE_COOKIE, sectionHref } from '@/lib/mode';
import { SlidingPill, useSlidingPill } from '@/components/useSlidingPill';
import { useAnchoredPanelFor, useDismissOnOutside } from '@/components/useAnchoredPanel';
import { CheckIcon, ChevronDownIcon } from '@/components/social/icons';

/**
 * Переключатель разделов в шапке: «Смотреть ▾ · Читать ▾ · Слушать».
 *
 * Было шесть вкладок в ряд (аниме, фильмы и сериалы, подкасты, книги, ранобэ,
 * манга) плюс три пункта навигации — строка читалась перечислением, глаз ни
 * за что не цеплялся (24.10.2026). Теперь три группы по роду занятия, а сами
 * разделы — в меню группы:
 *   • Смотреть — аниме и кино;
 *   • Читать   — книги, ранобэ, манга;
 *   • Слушать  — подкасты и аудиокниги (с 24.10.2026; пока раздел был
 *     один, вкладка была сразу ссылкой — код это по-прежнему умеет).
 *
 * Подсвечена группа раздела, где человек сейчас; в меню отмечен сам раздел.
 *
 * Кука aw_mode помнит только аниме/кино: по ней логотип и «/» ведут на
 * главную нужного видео-раздела. Ссылки на аниме и кино — короткими адресами
 * '/?mode=…' (обход закэшированного редиректа '/' → '/cinema', см.
 * middleware.ts) и с учётом текущей страницы: из каталога — в каталог
 * соседнего раздела (sectionHref в lib/mode.ts).
 */

type GroupKey = 'watch' | 'read' | 'listen';

interface SectionItem {
  value: ContentType;
  label: string;
  /** Свой адрес; у аниме и кино его нет — он зависит от страницы. */
  path?: string;
}

interface Group {
  key: GroupKey;
  label: string;
  items: SectionItem[];
}

/**
 * Значки групп — на телефоне вместо подписей (compact, уже sm): три слова
 * с отступами занимали ~280px из 351, и колокольчик с лупой уезжали за край
 * экрана. Линейные, 24×24, как остальные значки шапки.
 */
function GroupIcon({ group, className }: { group: GroupKey; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={['h-5 w-5 fill-none stroke-current', className ?? ''].join(' ')}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {group === 'watch' ? (
        <>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m10.5 9.5 4 2.5-4 2.5Z" />
        </>
      ) : group === 'read' ? (
        <>
          <path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H10a2 2 0 0 1 2 2v15a2.4 2.4 0 0 0-1.8-.8H4Z" />
          <path d="M20 5.2A2.2 2.2 0 0 0 17.8 3H14a2 2 0 0 0-2 2v15a2.4 2.4 0 0 1 1.8-.8H20Z" />
        </>
      ) : (
        <>
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
          <rect x="3" y="14" width="5" height="7" rx="2" />
          <rect x="16" y="14" width="5" height="7" rx="2" />
        </>
      )}
    </svg>
  );
}

/** Подпись группы: в compact на телефоне — значок, подпись остаётся
 *  скринридеру; с sm — слово. */
function GroupLabel({ group, compact }: { group: Group; compact: boolean }) {
  if (!compact) return <>{group.label}</>;
  return (
    <>
      <GroupIcon group={group.key} className="sm:hidden" />
      <span className="sr-only sm:not-sr-only">{group.label}</span>
    </>
  );
}

const GROUPS: Group[] = [
  {
    key: 'watch',
    label: 'Смотреть',
    items: [
      { value: 'anime', label: 'Аниме' },
      { value: 'cinema', label: 'Фильмы и сериалы' },
    ],
  },
  {
    key: 'read',
    label: 'Читать',
    items: [
      { value: 'book', label: 'Книги', path: '/books' },
      { value: 'ranobe', label: 'Ранобэ', path: '/ranobe' },
      { value: 'manga', label: 'Манга', path: '/manga' },
    ],
  },
  {
    key: 'listen',
    label: 'Слушать',
    items: [
      { value: 'podcast', label: 'Подкасты', path: '/podcasts' },
      { value: 'audiobook', label: 'Аудиокниги', path: '/audiobooks' },
    ],
  },
];

function setModeCookie(mode: ContentType) {
  document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}

/** Раздел по пути — для подкастов/книг/ранобэ/манги; null — видео-раздел. */
function sectionFromPath(pathname: string): ContentType | null {
  for (const group of GROUPS) {
    for (const item of group.items) {
      if (item.path && (pathname === item.path || pathname.startsWith(`${item.path}/`))) {
        return item.value;
      }
    }
  }
  return null;
}

function groupOf(section: ContentType): GroupKey {
  return GROUPS.find((g) => g.items.some((i) => i.value === section))?.key ?? 'watch';
}

/** Ширина выпадающей панели раздела, px. */
const PANEL_WIDTH = 224;

const TAB_CLASS =
  'press relative z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * compact — вариант для шапки: отступы плотнее, на телефоне рядом лупа и
 * значки.
 */
export default function ModeSwitch({
  active,
  compact = false,
}: {
  /** Видео-раздел по пути/куке (см. HeaderNav.useSectionMode). */
  active: ContentType;
  compact?: boolean;
}) {
  // Запоминаем открытый видео-раздел (в т.ч. при прямом заходе по URL).
  useEffect(() => {
    if (active === 'anime' || active === 'cinema') setModeCookie(active);
  }, [active]);

  const pathname = usePathname();
  const current = sectionFromPath(pathname) ?? active;

  // Какую группу подсвечивать прямо сейчас: на время перехода — ту, где
  // кликнули. Серверный рендер раздела занимает сотни миллисекунд, и всё это
  // время подсветка стояла бы на старой группе — будто клик не сработал.
  const [optimistic, setOptimistic] = useState<ContentType | null>(null);
  const shown = optimistic ?? current;
  useEffect(() => {
    setOptimistic(null);
  }, [current]);

  const { rootRef, setTabRef, pill } = useSlidingPill(groupOf(shown));

  const go = (item: SectionItem) => {
    if (item.value === current) return;
    // Кука — только для видео-разделов (см. комментарий к файлу).
    if (!item.path) setModeCookie(item.value);
    setOptimistic(item.value);
  };

  const hrefOf = (item: SectionItem) => item.path ?? sectionHref(pathname, item.value);
  const pad = compact ? 'px-2.5 py-1.5 sm:px-3.5' : 'px-4 py-2';

  return (
    <div
      ref={rootRef}
      // self-start обязателен: все родители переключателя — flex-колонки, и
      // без него контрол растягивался бы рамкой на всю ширину.
      className={[
        'relative inline-flex shrink-0 rounded-full border border-white/10 p-1',
        compact ? 'self-center bg-white/[0.04]' : 'self-start bg-bg-card',
      ].join(' ')}
    >
      <SlidingPill pill={pill} />
      {GROUPS.map((group) => {
        const isActive = group.key === groupOf(shown);
        const tone = isActive ? 'text-accent-fg' : 'text-gray-300 hover:text-white';

        // Один раздел — сразу ссылка, меню из одного пункта незачем.
        if (group.items.length === 1) {
          const item = group.items[0];
          return (
            <Link
              key={group.key}
              href={hrefOf(item)}
              // prefetch={false}: автопрефетч ссылок шапки ловит клиентский
              // роутер в гонку с middleware (см. историю в CinemaCard).
              prefetch={false}
              ref={setTabRef(group.key)}
              aria-current={item.value === current ? 'page' : undefined}
              title={item.label}
              onClick={() => go(item)}
              className={[TAB_CLASS, pad, tone].join(' ')}
            >
              <GroupLabel group={group} compact={compact} />
            </Link>
          );
        }

        return (
          <GroupMenu
            key={group.key}
            group={group}
            isActive={isActive}
            current={current}
            className={[TAB_CLASS, pad, tone].join(' ')}
            tabRef={setTabRef(group.key)}
            hrefOf={hrefOf}
            onPick={go}
            compact={compact}
          />
        );
      })}
    </div>
  );
}

/** Вкладка-группа с выпадающим меню разделов (модель WAI-ARIA menu button). */
function GroupMenu({
  group,
  isActive,
  current,
  className,
  tabRef,
  hrefOf,
  onPick,
  compact,
}: {
  group: Group;
  isActive: boolean;
  current: ContentType;
  className: string;
  tabRef: (el: HTMLElement | null) => void;
  hrefOf: (item: SectionItem) => string;
  onPick: (item: SectionItem) => void;
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Левый край панели. useAnchoredPanel ровняет панели по правому краю кнопки
  // (они у правого края шапки), а эта кнопка слева: панель уезжала бы за
  // левый край экрана на телефоне. Ровняем по левому краю кнопки и не даём
  // выйти за окно с отступом 12px.
  const [left, setLeft] = useState(12);
  const panelRef = useRef<HTMLDivElement>(null);
  const { anchorRef, box, measure } = useAnchoredPanelFor<HTMLButtonElement>(open);

  // Клик внутри панели не считается внешним: она живёт в <body>, а не рядом
  // с кнопкой (см. useDismissOnOutside).
  useDismissOnOutside(open, () => setOpen(false), anchorRef, panelRef);

  // Кнопка — одновременно якорь панели и вкладка для ползунка.
  const setButtonRef = useCallback(
    (el: HTMLButtonElement | null) => {
      (anchorRef as { current: HTMLButtonElement | null }).current = el;
      tabRef(el);
    },
    [anchorRef, tabRef],
  );

  const items = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

  // Открыли — фокус на текущий раздел группы (или первый).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const list = items();
      (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const openMenu = () => {
    // Меряем ДО показа — см. useAnchoredPanel.
    measure();
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setLeft(Math.max(12, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 12)));
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) anchorRef.current?.focus();
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const currentItem = group.items.find((i) => i.value === current);

  return (
    <>
      <button
        type="button"
        ref={setButtonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        // Скринридеру — и группу, и раздел внутри неё, если он текущий.
        aria-label={currentItem ? `${group.label}: ${currentItem.label}` : group.label}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={className}
      >
        <GroupLabel group={group} compact={compact} />
        {/* Шеврон — только при подписи: на телефоне у значка его место. */}
        <ChevronDownIcon
          className={[
            'h-3.5 w-3.5 opacity-70 transition-transform duration-200',
            compact ? 'hidden sm:block' : '',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={group.label}
            onKeyDown={onPanelKeyDown}
            style={{ top: box.top, left, width: PANEL_WIDTH }}
            className="glass-panel fixed z-50 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 p-1 shadow-2xl"
          >
            {group.items.map((item) => {
              const selected = item.value === current;
              return (
                <Link
                  key={item.value}
                  href={hrefOf(item)}
                  prefetch={false}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onPick(item);
                    close(false);
                  }}
                  className={[
                    'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm outline-none transition',
                    'hover:bg-white/10 focus-visible:bg-white/10',
                    selected ? 'font-semibold text-white' : 'text-gray-200',
                  ].join(' ')}
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center">
                    {selected ? <CheckIcon className="h-4 w-4 text-accent-text" /> : null}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

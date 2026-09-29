'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import SearchBox from './SearchBox';

/**
 * Поиск в шапке, свёрнутый в лупу.
 *
 * В шапке рядом с поиском стоят переключатель раздела, три раздела и пять
 * значков, и на телефоне полю оставалось около сотни пикселей — в него не
 * помещалось даже название тайтла. Теперь поле свёрнуто в значок справа, а
 * по нажатию всё остальное (children) прячется, и поиск получает всю строку.
 *
 * children не размонтируются, а только скрываются: внутри колокольчик с
 * подпиской на уведомления и счётчик онлайна — пересоздавать их на каждое
 * открытие поиска незачем.
 *
 * Сворачивается: крестиком, Esc (когда подсказки уже закрыты), переходом на
 * другую страницу и кликом мимо, если поле пустое. С набранным текстом по
 * клику мимо НЕ сворачиваем: подсказки живут порталом в <body>, и нажатие на
 * подсказку формально «мимо» — свернув поле, мы бы убили переход по ней.
 *
 * На странице результатов (/search) поле открыто сразу: там строка поиска и
 * есть главный элемент страницы.
 */
export default function HeaderSearch({
  unified,
  children,
}: {
  unified: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const onSearchPage = pathname === '/search';
  const [open, setOpen] = useState(onSearchPage);
  // Фокус в поле ставим только когда его открыли руками — на /search при
  // загрузке курсор в поле выдвигал бы на телефоне клавиатуру без спроса.
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  // Переход на другую страницу — поиск своё дело сделал.
  useEffect(() => {
    setOpen(onSearchPage);
    setFocusOnOpen(false);
  }, [pathname, onSearchPage]);

  // После сворачивания с клавиатуры возвращаем фокус на лупу: иначе он
  // проваливался бы в начало страницы вместе со скрытым полем.
  useEffect(() => {
    if (!open && returnFocusRef.current) {
      returnFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // «/» — открыть поиск с клавиатуры, как на GitHub и YouTube. Только когда
  // человек не печатает в каком-то поле.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setFocusOnOpen(true);
      setOpen(true);
      // Уже открыто — просто вернуть курсор в поле.
      rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = (restoreFocus: boolean) => {
    returnFocusRef.current = restoreFocus;
    setOpen(false);
  };

  return (
    <>
      {/* contents — обёртка не участвует в раскладке шапки, её дети остаются
          обычными элементами строки. */}
      <div className={open ? 'hidden' : 'contents'}>{children}</div>

      {open ? (
        <div
          ref={rootRef}
          className="ml-auto flex min-w-0 flex-1 items-center gap-1 md:max-w-2xl"
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            const input = e.currentTarget.querySelector<HTMLInputElement>('input[type="search"]');
            if (!onSearchPage && input && input.value.trim() === '') close(false);
          }}
        >
          <div className="min-w-0 flex-1">
            <SearchBox unified={unified} autoFocus={focusOnOpen} onEscape={() => close(true)} />
          </div>
          {!onSearchPage && (
            <button
              type="button"
              onClick={() => close(true)}
              aria-label="Закрыть поиск"
              title="Закрыть поиск"
              className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-300 transition hover:bg-white/5 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setFocusOnOpen(true);
            setOpen(true);
          }}
          aria-label="Поиск"
          title="Поиск (клавиша /)"
          className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-300 transition hover:bg-white/5 hover:text-white"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" className="h-5 w-5">
            <circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13 13L17.5 17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </>
  );
}

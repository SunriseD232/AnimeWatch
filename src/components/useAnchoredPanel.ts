'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Позиция для выпадающей панели, которая живёт в <body>, а не там, где
 * стоит её кнопка.
 *
 * ЗАЧЕМ ПОРТАЛ. Все дропдауны шапки лежали внутри неё, а у шапки свой
 * backdrop-filter. У такого элемента потомки размывают ЕГО, а не страницу под
 * ним — размытия не видно вовсе, панель выглядит просто полупрозрачной. Он же
 * становится containing block для position: fixed, так что и координаты
 * считались бы от шапки, а не от окна. Оба эффекта ловились вживую.
 *
 * ЗАЧЕМ МЕРИТЬ ДО ПОКАЗА. Не спозиционированный fixed-блок, отрисованный на
 * первом кадре, вылезает за правый край, страница получает горизонтальную
 * прокрутку — и замер возвращает координаты со сдвигом на её величину.
 * Панель улетает за левый край. Поэтому open() меряет ДО того, как панель
 * появится в разметке.
 */
export interface AnchoredBox {
  /** Верх панели: низ шапки, если она есть, иначе низ самой кнопки. */
  top: number;
  /** Отступ справа — панель выравнивается по правому краю кнопки. */
  right: number;
}

export function useAnchoredPanel<T extends HTMLElement>() {
  const anchorRef = useRef<T>(null);
  const [box, setBox] = useState<AnchoredBox | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const header = document.querySelector('header');
    setBox({
      top: (header ? header.getBoundingClientRect().bottom : a.bottom) + 8,
      // Не ближе 12px к краю окна: на телефоне кнопка стоит не вплотную, и
      // панель шириной в 320px иначе уезжала бы левым краем за экран.
      right: Math.max(12, window.innerWidth - a.right),
    });
  }, []);

  /** Подписка на прокрутку и ресайз, пока панель открыта. */
  const track = useCallback(
    (open: boolean) => {
      if (!open) return undefined;
      window.addEventListener('resize', measure);
      window.addEventListener('scroll', measure, { passive: true });
      return () => {
        window.removeEventListener('resize', measure);
        window.removeEventListener('scroll', measure);
      };
    },
    [measure],
  );

  return { anchorRef, box, measure, track };
}

/** Хук-обёртка: подписка сама следит за флагом открытости. */
export function useAnchoredPanelFor<T extends HTMLElement>(open: boolean) {
  const panel = useAnchoredPanel<T>();
  const { track } = panel;
  useEffect(() => track(open), [open, track]);
  return panel;
}

/**
 * Закрытие панели по клику вовне и по Escape — с учётом того, что сама
 * панель живёт в <body>, а не рядом с кнопкой.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ХУК. Каждая портальная панель раньше писала этот
 * обработчик сама и сверялась ТОЛЬКО с обёрткой кнопки. Панель ей не
 * потомок (она в другом месте дерева), поэтому любой mousedown внутри самой
 * панели считался «кликом вовне» и закрывал её — ДО того, как браузер
 * успевал выстрелить click. Элемент к этому моменту уже размонтирован, и
 * клик не доезжал никуда.
 *
 * Ловилось это как три разные жалобы: крестик в уведомлениях «просто
 * закрывает уведомления» вместо того, чтобы убрать строку; из уведомления
 * не открыть тайтл; у админа не открываются профили пользователей из списка
 * онлайна. Причина одна.
 *
 * Слушаем mousedown, а не click: панель должна закрываться сразу по нажатию,
 * иначе выделение текста мышью из панели наружу выглядит залипанием.
 */
export function useDismissOnOutside(
  open: boolean,
  onDismiss: () => void,
  /** Элементы, клик внутри которых НЕ считается внешним: кнопка-якорь и
   *  сама панель. null-значения игнорируются — панель существует только
   *  пока открыта. */
  ...insideRefs: RefObject<HTMLElement | null>[]
): void {
  const refs = useRef(insideRefs);
  refs.current = insideRefs;
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      for (const ref of refs.current) {
        if (ref.current?.contains(target)) return;
      }
      dismiss.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
}

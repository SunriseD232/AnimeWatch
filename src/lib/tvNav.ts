/**
 * Пространственная навигация стрелками для Android TV-обёртки (см.
 * capacitor.config.ts — android.appendUserAgent: 'MediaWatchTV',
 * src/components/TvNavigation.tsx). Сайт спроектирован под мышь/тач:
 * обычный Tab-порядок идёт по DOM, а не по экрану, поэтому "вправо" в
 * верхней строке навигации может увести фокус куда-то в середину сетки
 * постеров вместо соседней кнопки. Здесь вместо Tab-порядка ищем
 * геометрически ближайший фокусируемый элемент в сторону нажатой стрелки —
 * стандартный приём "spatial navigation", применяемый TV-платформами и
 * рядом браузеров нативно (у Android System WebView такой встроенной
 * функции нет, поэтому реализована здесь).
 */

export type TvDirection = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
].join(', ');

/** Маркер добавлен в User-Agent WebView только в Android TV-обёртке (см.
 *  capacitor.config.ts) — обычный браузер и iOS-обёртка его не видят. */
export function isTvUserAgent(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('MediaWatchTV');
}

function isVisible(el: HTMLElement, rect: DOMRect): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function collectCandidates(): { el: HTMLElement; rect: DOMRect }[] {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const result: { el: HTMLElement; rect: DOMRect }[] = [];
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (isVisible(el, rect)) result.push({ el, rect });
  }
  return result;
}

/**
 * Переносит фокус на ближайший в направлении `direction` элемент
 * относительно текущего document.activeElement. Возвращает true, если
 * фокус реально сдвинулся (вызывающий код должен вызвать
 * e.preventDefault(), чтобы стрелка не проскроллила страницу вместо
 * перемещения фокуса) — false, если двигаться некуда (край сетки) или
 * фокусируемых элементов на странице нет вовсе.
 */
export function focusNearest(direction: TvDirection): boolean {
  const candidates = collectCandidates();
  if (candidates.length === 0) return false;

  const current = document.activeElement as HTMLElement | null;
  const isCurrentFocusable =
    current && current !== document.body && candidates.some((c) => c.el === current);

  if (!isCurrentFocusable) {
    // Ничего подходящего не сфокусировано (первая стрелка после загрузки
    // страницы, либо фокус потерян после клиентской навигации) — просто
    // берём первый элемент по DOM-порядку, дальше пользователь уже
    // ориентируется стрелками сам.
    candidates[0].el.focus();
    return true;
  }

  const from = current!.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const { el, rect } of candidates) {
    if (el === current) continue;
    const dx = rect.left + rect.width / 2 - fromX;
    const dy = rect.top + rect.height / 2 - fromY;

    // Отбрасываем элементы не в нужной полуплоскости, затем оцениваем
    // расстояние по основной оси (в сторону нажатия) плюс штраф за смещение
    // по перпендикулярной оси — коэффициент 2 у перпендикуляра, чтобы
    // сосед в том же ряду/столбце выигрывал у чуть более близкого по
    // диагонали элемента из соседнего ряда.
    let primary: number;
    let cross: number;
    if (direction === 'up') {
      if (dy >= -1) continue;
      primary = -dy;
      cross = Math.abs(dx);
    } else if (direction === 'down') {
      if (dy <= 1) continue;
      primary = dy;
      cross = Math.abs(dx);
    } else if (direction === 'left') {
      if (dx >= -1) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else {
      if (dx <= 1) continue;
      primary = dx;
      cross = Math.abs(dy);
    }

    const score = primary + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (!best) return false;
  best.focus();
  best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

const KEY_TO_DIRECTION: Record<string, TvDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * Элементы, которым сами стрелки нужны для собственной логики (курсор в
 * тексте, значение range-слайдера — громкость/перемотка в OwnPlayer.tsx) —
 * там spatial navigation должна уступать нативному поведению поля, а не
 * перехватывать стрелки на себя.
 */
function ownsArrowKeys(target: EventTarget | null, direction: TvDirection): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    // range (слайдеры плеера) и текстовые поля — влево/вправо им нужны
    // самим; вверх/вниз для них смысла не имеет, отдаём под навигацию.
    if (direction === 'left' || direction === 'right') return true;
    if (type !== 'range') return false;
  }
  return false;
}

/** Общий обработчик keydown для TvNavigation.tsx — вынесен отдельно, чтобы
 *  логику можно было проверить без монтирования React-компонента. */
export function handleTvKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return; // компонент уже обработал стрелку сам (см. SearchBox.tsx)
  const direction = KEY_TO_DIRECTION[e.key];
  if (!direction) return;
  if (ownsArrowKeys(e.target, direction)) return;
  if (focusNearest(direction)) {
    e.preventDefault();
  }
}

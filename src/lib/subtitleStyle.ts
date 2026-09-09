/**
 * Оформление субтитров — пользовательская настройка плеера.
 *
 * ЗАЧЕМ СВОЙ РЕНДЕР. Браузер рисует дорожку `<track>` сам, и повлиять на это
 * можно только псевдоэлементом ::cue: он умеет цвет, фон и размер, но НЕ
 * умеет главного — сдвинуть текст выше панели управления. Нативные субтитры
 * позиционируются относительно видео, и на паузе или при наведении их
 * закрывает собственная панель плеера. Поэтому дорожка переводится в режим
 * hidden, а текст активной реплики рисуется обычным элементом поверх видео —
 * тогда и положение наше, и стили любые.
 */

export interface SubtitleStyle {
  /** Цвет текста. */
  color: string;
  /** Толщина обводки в пикселях; 0 — без обводки. */
  outline: number;
  /** Цвет подложки под текстом. */
  background: string;
  /** Прозрачность подложки, 0..1. */
  backgroundOpacity: number;
  /** Прозрачность самого текста, 0..1. */
  opacity: number;
  /** Размер в процентах от базового (100 = как сейчас). */
  size: number;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  color: '#ffffff',
  // Обводка, а не тень: на светлых кадрах тень сливается, а контур в 2px
  // держит читаемость на любом фоне — так делают все плееры.
  outline: 2,
  background: '#000000',
  // Подложка по умолчанию почти прозрачная: она нужна как страховка на
  // пёстрых кадрах, но сплошная чёрная плашка закрывает кадр сильнее, чем
  // помогает.
  backgroundOpacity: 0.35,
  opacity: 1,
  size: 100,
};

export const SUBTITLE_STYLE_KEY = 'mediawatch:subtitle-style';

/** Числа приходят из localStorage, то есть от кого угодно — зажимаем. */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function colorOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function normalizeSubtitleStyle(raw: unknown): SubtitleStyle {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    color: colorOr(s.color, DEFAULT_SUBTITLE_STYLE.color),
    outline: clamp(s.outline, 0, 6, DEFAULT_SUBTITLE_STYLE.outline),
    background: colorOr(s.background, DEFAULT_SUBTITLE_STYLE.background),
    backgroundOpacity: clamp(s.backgroundOpacity, 0, 1, DEFAULT_SUBTITLE_STYLE.backgroundOpacity),
    opacity: clamp(s.opacity, 0.2, 1, DEFAULT_SUBTITLE_STYLE.opacity),
    size: clamp(s.size, 60, 200, DEFAULT_SUBTITLE_STYLE.size),
  };
}

export function readSubtitleStyle(): SubtitleStyle {
  try {
    const raw = localStorage.getItem(SUBTITLE_STYLE_KEY);
    return raw ? normalizeSubtitleStyle(JSON.parse(raw)) : DEFAULT_SUBTITLE_STYLE;
  } catch {
    return DEFAULT_SUBTITLE_STYLE;
  }
}

export function storeSubtitleStyle(style: SubtitleStyle): void {
  try {
    localStorage.setItem(SUBTITLE_STYLE_KEY, JSON.stringify(style));
  } catch {
    // Приватный режим или запрет на хранилище — настройка просто не переживёт
    // перезагрузку, ронять из-за этого плеер незачем.
  }
}

/** #rrggbb + прозрачность → rgba() для CSS. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Обводка через text-shadow в четыре стороны, а не -webkit-text-stroke:
 * последний рисует контур ПОВЕРХ глифа, съедая тонкие штрихи кириллицы, и
 * при 2px текст становится заметно тяжелее. Четыре тени дают тот же контур
 * снаружи буквы.
 */
export function outlineShadow(width: number): string | undefined {
  if (width <= 0) return undefined;
  const w = width;
  return [
    `-${w}px 0 0 #000`,
    `${w}px 0 0 #000`,
    `0 -${w}px 0 #000`,
    `0 ${w}px 0 #000`,
    `-${w}px -${w}px 0 #000`,
    `${w}px -${w}px 0 #000`,
    `-${w}px ${w}px 0 #000`,
    `${w}px ${w}px 0 #000`,
  ].join(', ');
}

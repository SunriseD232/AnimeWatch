/**
 * Настройки читалки манги (24.10.2026: «как на MangaLib», плюс то, что есть
 * у MangaDex). Один объект на пользователя: в profiles.manga_reader
 * (миграция 0062), чтобы на телефоне и на компьютере читалось одинаково, и
 * копией в localStorage — она применяется сразу и работает без входа.
 *
 * Модуль чистый: без React и без сети. Читалка и панель настроек берут
 * отсюда типы, значения по умолчанию, проверку присланного и схемы зон
 * нажатия, а /api/profile — ту же проверку перед записью.
 */

/** Горизонтальный — по странице; Вертикальный — лента с промежутками;
 *  Полоса — лента встык (вебтуны). Названия — как у MangaLib. */
export type ReaderMode = 'paged' | 'vertical' | 'strip';
export type ReaderDirection = 'ltr' | 'rtl';
export type ReaderTheme = 'dark' | 'light' | 'system';
export type ReaderFit = 'width' | 'height';
/** Где работают зоны нажатия: только по картинке или по всему экрану. */
export type ReaderTapArea = 'image' | 'screen';
export type ReaderProgressBar = 'hidden' | 'thin' | 'normal';
export type ReaderProgressPosition = 'bottom' | 'left' | 'right';
export type TapZoneScheme =
  | 'default'
  | 'kindle'
  | 'forward'
  | 'quadrant'
  | 'horizontal'
  | 'lshape'
  | 'sides'
  | 'off';

export interface MangaReaderSettings {
  mode: ReaderMode;
  /** Разворот из двух страниц — только в режиме «Горизонтальный» и только
   *  на широком экране (на телефоне две страницы были бы нечитаемы). */
  doublePage: boolean;
  direction: ReaderDirection;
  theme: ReaderTheme;
  tapZones: TapZoneScheme;
  tapArea: ReaderTapArea;
  fit: ReaderFit;
  /** Растягивать картинки меньше экрана. Выключено — мелкая страница
   *  остаётся в своём размере, без мыла от увеличения. */
  upscale: boolean;
  /** Ширина ленты/страницы, % от доступной ширины. */
  width: number;
  /** Яркость страниц, %. Ниже 100 — затемнение для чтения в темноте. */
  brightness: number;
  hidePageNumber: boolean;
  progressBar: ReaderProgressBar;
  progressPosition: ReaderProgressPosition;
  /** Листнуть дальше последней страницы — открыть следующую главу. */
  autoNextChapter: boolean;
  /** Во весь экран — прятать панель читалки, пока её не позовут нажатием
   *  в зону «Меню». */
  autoHideToolbar: boolean;
}

export const DEFAULT_READER_SETTINGS: MangaReaderSettings = {
  // Лента — то, как читалка работала до появления настроек: никому молча
  // поведение не меняем.
  mode: 'vertical',
  doublePage: false,
  direction: 'ltr',
  theme: 'dark',
  tapZones: 'default',
  tapArea: 'image',
  fit: 'width',
  // Как у MangaLib: мелкую страницу не растягиваем. Заодно на широком
  // экране лента остаётся в родной ширине страниц, как было до настроек.
  upscale: false,
  width: 100,
  brightness: 100,
  hidePageNumber: false,
  progressBar: 'thin',
  progressPosition: 'bottom',
  autoNextChapter: true,
  autoHideToolbar: true,
};

export const WIDTH_MIN = 30;
export const BRIGHTNESS_MIN = 20;

/** Ключ копии в localStorage. */
export const READER_SETTINGS_STORAGE_KEY = 'mw:manga-reader-settings';

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export const TAP_ZONE_SCHEMES: readonly TapZoneScheme[] = [
  'default',
  'kindle',
  'forward',
  'quadrant',
  'horizontal',
  'lshape',
  'sides',
  'off',
];

/**
 * Любое присланное (из базы, из localStorage, из тела запроса) — в полный
 * корректный объект. Неизвестное поле молча отбрасывается, кривое значение
 * заменяется значением по умолчанию: настройки читалки не повод для ошибки.
 */
export function normalizeReaderSettings(raw: unknown): MangaReaderSettings {
  const d = DEFAULT_READER_SETTINGS;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    mode: pick(o.mode, ['paged', 'vertical', 'strip'] as const, d.mode),
    doublePage: bool(o.doublePage, d.doublePage),
    direction: pick(o.direction, ['ltr', 'rtl'] as const, d.direction),
    theme: pick(o.theme, ['dark', 'light', 'system'] as const, d.theme),
    tapZones: pick(o.tapZones, TAP_ZONE_SCHEMES, d.tapZones),
    tapArea: pick(o.tapArea, ['image', 'screen'] as const, d.tapArea),
    fit: pick(o.fit, ['width', 'height'] as const, d.fit),
    upscale: bool(o.upscale, d.upscale),
    width: clampInt(o.width, WIDTH_MIN, 100, d.width),
    brightness: clampInt(o.brightness, BRIGHTNESS_MIN, 100, d.brightness),
    hidePageNumber: bool(o.hidePageNumber, d.hidePageNumber),
    progressBar: pick(o.progressBar, ['hidden', 'thin', 'normal'] as const, d.progressBar),
    progressPosition: pick(o.progressPosition, ['bottom', 'left', 'right'] as const, d.progressPosition),
    autoNextChapter: bool(o.autoNextChapter, d.autoNextChapter),
    autoHideToolbar: bool(o.autoHideToolbar, d.autoHideToolbar),
  };
}

// ───────────────────────────── Зоны нажатия ─────────────────────────────

export type TapAction = 'prev' | 'next' | 'menu';

/** Прямоугольник в долях экрана (0..1) и что делает нажатие в нём. */
export interface TapZone {
  x: number;
  y: number;
  w: number;
  h: number;
  action: TapAction;
}

const T = 1 / 3;
const CENTER: TapZone = { x: T, y: T, w: T, h: T, action: 'menu' };

/**
 * Схемы — в духе MangaLib и Mihon (Tachiyomi). Зоны проверяются по порядку,
 * первая подходящая побеждает; всё, что не покрыто, — «Меню». В каждой
 * схеме есть зона «Меню» (у Kindle — верхняя полоса, у остальных — центр),
 * так что запутаться, как вернуть панель, нельзя.
 */
const SCHEMES: Record<TapZoneScheme, { label: string; hint: string; zones: TapZone[] }> = {
  default: {
    label: 'По умолчанию',
    hint: 'Левая треть — назад, правая — вперёд, середина — меню.',
    zones: [
      { x: 0, y: 0, w: T, h: 1, action: 'prev' },
      { x: 2 * T, y: 0, w: T, h: 1, action: 'next' },
    ],
  },
  kindle: {
    label: 'Kindle-подобное',
    hint: 'Верхняя полоса — меню, узкая левая часть — назад, остальное — вперёд.',
    zones: [
      { x: 0, y: 0, w: 1, h: 0.2, action: 'menu' },
      { x: 0, y: 0.2, w: 0.25, h: 0.8, action: 'prev' },
      { x: 0.25, y: 0.2, w: 0.75, h: 0.8, action: 'next' },
    ],
  },
  forward: {
    label: 'Вперёд',
    hint: 'Весь экран листает вперёд, середина — меню. Назад — клавишами или жестом.',
    zones: [CENTER, { x: 0, y: 0, w: 1, h: 1, action: 'next' }],
  },
  quadrant: {
    label: 'Ква-драт',
    hint: 'Четверти экрана: левые — назад, правые — вперёд, середина — меню.',
    zones: [
      CENTER,
      { x: 0, y: 0, w: 0.5, h: 1, action: 'prev' },
      { x: 0.5, y: 0, w: 0.5, h: 1, action: 'next' },
    ],
  },
  horizontal: {
    label: 'Горизонтальное',
    hint: 'Верхняя треть — назад, нижняя — вперёд, середина — меню.',
    zones: [
      { x: 0, y: 0, w: 1, h: T, action: 'prev' },
      { x: 0, y: 2 * T, w: 1, h: T, action: 'next' },
    ],
  },
  lshape: {
    label: 'L-образное',
    hint: 'Верх и левый край — назад, низ и правый край — вперёд, середина — меню.',
    zones: [
      { x: 0, y: 0, w: 1, h: T, action: 'prev' },
      { x: 0, y: T, w: T, h: T, action: 'prev' },
      { x: 2 * T, y: T, w: T, h: T, action: 'next' },
      { x: 0, y: 2 * T, w: 1, h: T, action: 'next' },
    ],
  },
  sides: {
    label: 'По бокам',
    hint: 'Узкие полосы у краёв: слева — назад, справа — вперёд. Остальное — меню.',
    zones: [
      { x: 0, y: 0, w: 0.15, h: 1, action: 'prev' },
      { x: 0.85, y: 0, w: 0.15, h: 1, action: 'next' },
    ],
  },
  off: {
    label: 'Выключены',
    hint: 'Нажатие только показывает и прячет меню. Листать — прокруткой и клавишами.',
    zones: [],
  },
};

export function tapZoneLabel(scheme: TapZoneScheme): string {
  return SCHEMES[scheme].label;
}

export function tapZoneHint(scheme: TapZoneScheme): string {
  return SCHEMES[scheme].hint;
}

/** Зоны схемы с учётом направления: справа налево «назад» и «вперёд»
 *  меняются местами, как и страницы. */
export function tapZonesFor(scheme: TapZoneScheme, direction: ReaderDirection): TapZone[] {
  const zones = SCHEMES[scheme].zones;
  if (direction === 'ltr') return zones;
  return zones.map((zone) =>
    zone.action === 'menu' ? zone : { ...zone, action: zone.action === 'prev' ? 'next' : 'prev' },
  );
}

/** Действие для точки нажатия (доли 0..1 от области нажатия). */
export function tapActionAt(
  scheme: TapZoneScheme,
  direction: ReaderDirection,
  fx: number,
  fy: number,
): TapAction {
  for (const zone of tapZonesFor(scheme, direction)) {
    if (fx >= zone.x && fx < zone.x + zone.w && fy >= zone.y && fy < zone.y + zone.h) {
      return zone.action;
    }
  }
  return 'menu';
}

// ───────────────────────────── Горячие клавиши ─────────────────────────────

/** Список для справки в панели; обработка — в MangaReader. */
export const READER_HOTKEYS: { keys: string; action: string }[] = [
  { keys: '→ / D', action: 'Следующая страница (справа налево — предыдущая)' },
  { keys: '← / A', action: 'Предыдущая страница (справа налево — следующая)' },
  { keys: 'Пробел / Shift+Пробел', action: 'Вперёд / назад на экран' },
  { keys: '↓ / ↑', action: 'Прокрутка' },
  { keys: 'Home / End', action: 'Начало / конец главы' },
  { keys: '] / [', action: 'Следующая / предыдущая глава' },
  { keys: 'F', action: 'Во весь экран' },
  { keys: 'S', action: 'Настройки' },
  { keys: 'C', action: 'Оглавление' },
  { keys: 'M', action: 'Показать / спрятать панель' },
  { keys: 'Esc', action: 'Закрыть панель или выйти из полноэкранного режима' },
];

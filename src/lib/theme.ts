/**
 * Тема оформления: акцент (интерфейс) + пресет фона (основная тема).
 *
 * Как это устроено целиком:
 *
 * 1. `tailwind.config.ts` больше не держит сами цвета — только ссылки на
 *    CSS-переменные (`rgb(var(--accent) / <alpha-value>)`). Значения в
 *    каналах («41 151 255», без `rgb()`) именно ради `<alpha-value>`: по
 *    коду 130+ мест вида `bg-accent/60`, `bg-bg-card/50`, и с готовой
 *    строкой `#2997ff` модификатор прозрачности Tailwind не работал бы.
 * 2. Дефолты переменных — в `globals.css` (`:root`). Это же значение видит
 *    неавторизованный посетитель и любой, кто тему не трогал.
 * 3. `components/ThemeScript.tsx` — синхронный скрипт в `<head>`, до первой
 *    отрисовки применяет тему из localStorage. Без него был бы кадр синего
 *    интерфейса перед перекраской.
 * 4. `components/ThemeSync.tsx` — после загрузки тянет тему из БД
 *    (`/api/theme`) и обновляет зеркало в localStorage. Это и есть
 *    кросс-девайс: на новом устройстве localStorage пуст, тема приезжает с
 *    сервера.
 * 5. `components/ThemeSettings.tsx` в профиле — выбор и сохранение.
 *
 * Почему не серверный рендер темы (async layout + чтение Supabase): корневой
 * layout сейчас синхронный, и любое обращение к cookies/БД в нём переводит в
 * динамический рендер ВСЕ страницы, включая 34 статических. Платить этим за
 * настройку оформления не стоит — блокирующий скрипт решает ту же задачу
 * (никакого мигания) без потери статики.
 */

export type PaletteId = 'black' | 'graphite' | 'midnight';

export interface Theme {
  /** #rrggbb */
  accent: string;
  palette: PaletteId;
}

/** Синий Apple для тёмного режима — исходная палитра сайта. */
export const DEFAULT_THEME: Theme = {
  accent: '#2997ff',
  palette: 'black',
};

/** Готовые акценты — системные цвета Apple для dark mode. Произвольный
 *  оттенок тоже можно (color-picker в ThemeSettings), это просто быстрый
 *  выбор без возни с пипеткой. */
export const ACCENT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'blue', label: 'Синий', value: '#2997ff' },
  { id: 'purple', label: 'Фиолетовый', value: '#bf5af2' },
  { id: 'pink', label: 'Розовый', value: '#ff375f' },
  { id: 'orange', label: 'Оранжевый', value: '#ff9f0a' },
  { id: 'green', label: 'Зелёный', value: '#30d158' },
  { id: 'teal', label: 'Бирюзовый', value: '#40c8e0' },
];

/** Фоновые пресеты. Только тёмные: весь интерфейс построен на светлом тексте
 *  поверх тёмного холста (см. globals.css — body text-gray-100), светлая тема
 *  потребовала бы переписать контрастные классы во всех компонентах, это
 *  отдельная большая задача, а не настройка. */
export const BG_PRESETS: {
  id: PaletteId;
  label: string;
  hint: string;
  bg: string;
  soft: string;
  card: string;
}[] = [
  {
    id: 'black',
    label: 'Чёрная',
    hint: 'Истинно чёрный холст — как на Apple TV',
    bg: '#000000',
    soft: '#151517',
    card: '#1d1d1f',
  },
  {
    id: 'graphite',
    label: 'Графит',
    hint: 'Мягче чёрного, меньше контраст по краям',
    bg: '#131315',
    soft: '#1c1c1f',
    card: '#252528',
  },
  {
    id: 'midnight',
    label: 'Полночь',
    hint: 'Тёмно-синий холст с холодным оттенком',
    bg: '#05070f',
    soft: '#0e131f',
    card: '#161d2b',
  },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

export function isPaletteId(value: unknown): value is PaletteId {
  return BG_PRESETS.some((p) => p.id === value);
}

/** Приводит что угодно (тело запроса, строку из localStorage, строку из БД)
 *  к валидной теме — молча заменяя мусор дефолтом. Тема не тот случай, где
 *  стоит падать с ошибкой: сломанное значение должно просто дать сайт с
 *  обычной палитрой. */
export function normalizeTheme(raw: unknown): Theme {
  const source = (raw ?? {}) as Partial<Theme>;
  return {
    accent: isHexColor(source.accent) ? source.accent.toLowerCase() : DEFAULT_THEME.accent,
    palette: isPaletteId(source.palette) ? source.palette : DEFAULT_THEME.palette,
  };
}

/** '#2997ff' → '41 151 255' — формат каналов для `rgb(var(--x) / <alpha>)`. */
export function hexToChannels(hex: string): string {
  const v = isHexColor(hex) ? hex : DEFAULT_THEME.accent;
  const n = parseInt(v.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/**
 * Цвет текста ПОВЕРХ заливки акцентом — тёмный или белый, что читается.
 *
 * Белый на акценте не проходит по контрасту НИ НА ОДНОМ пресете: синий
 * 3.02:1, фиолетовый и розовый 3.52:1, оранжевый 2.06:1, зелёный 2.02:1,
 * бирюзовый 1.99:1 — при норме 4.5:1 для обычного текста (WCAG 1.4.3) и
 * 3:1 для значков (1.4.11). Проверено расчётом по всем шести пресетам.
 * Почти-чёрный на тех же цветах даёт от 5.58:1 до 9.87:1.
 *
 * Дело в том, что это системные цвета Apple для ТЁМНОГО режима: они
 * задуманы как текст на чёрном холсте, а не как холст под белым текстом.
 * Затемнять саму заливку до 4.5:1 значило бы получить грязный цвет вместо
 * выбранного пользователем — поэтому меняем не заливку, а текст на ней.
 *
 * Порог — точка, где белый и почти-чёрный дают одинаковый контраст:
 * (L+0.05)² = 0.0545 · 1.05, то есть L ≈ 0.189. Свой акцент пипеткой может
 * быть и тёмным, и тогда белый тут выигрывает честно.
 */
const ACCENT_FG_DARK = '11 11 15';
const ACCENT_FG_LIGHT = '255 255 255';

export function relativeLuminance(hex: string): number {
  const v = isHexColor(hex) ? hex : DEFAULT_THEME.accent;
  const n = parseInt(v.slice(1), 16);
  const channel = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

export function accentForeground(hex: string): string {
  return relativeLuminance(hex) > 0.189 ? ACCENT_FG_DARK : ACCENT_FG_LIGHT;
}

/** Оттенок наведения: осветление к белому на `amount`. Отдельной настройки
 *  на hover нет намеренно — она бы только позволила выбрать несочетающуюся
 *  пару. 0.14 подобрано так, чтобы #2997ff дал #46a6ff — прежний ручной
 *  hover #47a9ff с точностью до единиц канала. */
export function lightenHex(hex: string, amount = 0.14): string {
  const v = isHexColor(hex) ? hex : DEFAULT_THEME.accent;
  const n = parseInt(v.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const out = (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255);
  return `#${out.toString(16).padStart(6, '0')}`;
}

/** Пары «CSS-переменная → значение в каналах» для данной темы. Единственное
 *  место, где тема превращается в конкретные переменные — используется и
 *  клиентским применением, и inline-скриптом в <head>. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const t = normalizeTheme(theme);
  const palette = BG_PRESETS.find((p) => p.id === t.palette) ?? BG_PRESETS[0];
  return {
    '--accent': hexToChannels(t.accent),
    '--accent-hover': hexToChannels(lightenHex(t.accent)),
    '--accent-fg': accentForeground(t.accent),
    '--bg': hexToChannels(palette.bg),
    '--bg-soft': hexToChannels(palette.soft),
    '--bg-card': hexToChannels(palette.card),
  };
}

/**
 * Применяет тему к документу. Вызывается и при живом предпросмотре в
 *  настройках, и после подтягивания темы с сервера.
 *
 * Переходы на время подмены гасятся. Смена палитры меняет цвет, фон, рамку и
 * тень почти у каждого элемента разом, и все их transition стартуют в один
 * кадр — вместо мгновенного переключения экран «размазывается» на несколько
 * сотен миллисекунд, причём разные элементы доезжают вразнобой. Классический
 * приём: вставить правило-глушилку, форсировать пересчёт стилей (чтение
 * offsetHeight), применить цвета и снять глушилку на следующем кадре.
 */
export function applyTheme(theme: Theme): void {
  const vars = themeToCssVars(theme);
  const root = document.documentElement;

  const killer = document.createElement('style');
  killer.textContent = '*,*::before,*::after{transition:none !important}';
  document.head.appendChild(killer);

  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  // Чтение offsetHeight — синхронный пересчёт стилей: без него браузер мог бы
  // объединить добавление и удаление глушилки в один кадр, и она бы не
  // сработала вовсе.
  void root.offsetHeight;
  requestAnimationFrame(() => killer.remove());
}

export const THEME_STORAGE_KEY = 'mediawatch:theme';

export function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? normalizeTheme(JSON.parse(raw)) : null;
  } catch {
    // Приватный режим/заблокированные site data — не повод ломать страницу.
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalizeTheme(theme)));
  } catch {
    /* см. readStoredTheme */
  }
}

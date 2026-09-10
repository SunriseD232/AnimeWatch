import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Единственный брейкпоинт, где панель фильтров помещается в поле
      // страницы и не отнимает ширину у карточек. Он не только по ширине:
      // на низком окне панель всё равно пришлось бы прокручивать, поэтому
      // высота участвует наравне. Ниже любого из порогов панель встаёт
      // колонкой рядом с выдачей (см. CatalogArea).
      //
      // raw, а не min/max: обычные брейкпоинты Tailwind умеют только ширину.
      // Те же числа продублированы в CatalogDesktopFilters (для JS) и в
      // globals.css (для сетки карточек) — держать их в синхроне.
      screens: {
        'filters-side': { raw: '(min-width: 1745px) and (min-height: 890px)' },
      },

      // Сами цвета здесь больше не задаются — только ссылки на CSS-
      // переменные, чтобы пользователь мог поменять палитру в профиле без
      // пересборки (см. lib/theme.ts). Дефолты переменных — в globals.css:
      // тот же чёрный холст в духе Apple TV и синий Apple для dark mode,
      // что были захардкожены здесь раньше.
      //
      // Формат каналов («41 151 255»), а не готовый rgb()/hex — обязателен
      // для <alpha-value>: по коду 130+ мест вида `bg-accent/60` и
      // `bg-bg-card/50`, с hex-строкой модификатор прозрачности Tailwind
      // молча перестал бы работать.
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          soft: 'rgb(var(--bg-soft) / <alpha-value>)',
          card: 'rgb(var(--bg-card) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          // Текст и значки ПОВЕРХ заливки акцентом: белый на акценте не
          // проходит по контрасту ни на одном пресете, см. accentForeground
          // в lib/theme.ts. Пара всегда вместе: `bg-accent text-accent-fg`.
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
        },
      },
      fontFamily: {
        // Inter — ближайшее веб-приближение SF Pro на не-Apple платформах;
        // -apple-system подхватит настоящий SF Pro на самих устройствах Apple.
        sans: [
          'var(--font-inter)',
          '-apple-system',
          'BlinkMacSystemFont',
          'ui-sans-serif',
          'system-ui',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  // Требует явного :hover, а не имитации касанием — на iOS/Android ссылки и
  // кнопки с hover:-классами (карточки в каруселях, кнопки) иначе требовали
  // двух тапов: первый только «наводил», второй уже переходил по ссылке.
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [],
};

export default config;

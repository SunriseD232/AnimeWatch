import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Тёмная палитра в духе Apple TV / apple.com: истинно чёрный холст,
        // фирменный тёмный уголь (#1d1d1f) для приподнятых поверхностей —
        // тот самый оттенок, что на apple.com в тёмных секциях.
        bg: {
          DEFAULT: '#000000',
          soft: '#151517',
          card: '#1d1d1f',
        },
        // Синий Apple для тёмного режима (тот же, что ссылки на apple.com
        // в dark mode), а не нейтральный «дефолт дизайн-системы».
        accent: {
          DEFAULT: '#2997ff',
          hover: '#47a9ff',
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

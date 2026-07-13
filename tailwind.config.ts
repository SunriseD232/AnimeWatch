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
        bg: {
          DEFAULT: '#0d0d12',
          soft: '#16161e',
          card: '#1c1c26',
        },
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#6a49f2',
        },
      },
    },
  },
  plugins: [],
};

export default config;

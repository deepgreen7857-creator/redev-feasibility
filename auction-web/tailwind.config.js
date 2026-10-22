/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Noto Sans KR"', 'system-ui', 'sans-serif'] },
      colors: {
        ink: '#17233A', paper: '#F3F5F7', line: '#DCE1E7', brand: '#0F5E4D', brand2: '#E8F2EF',
        now: '#0F7B5A', wait: '#B7791F', hard: '#B83A3A', cash: '#3B5BA9',
      },
    },
  },
  plugins: [],
};

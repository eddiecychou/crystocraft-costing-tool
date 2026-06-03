/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          200: '#c7d7fd',
          300: '#a5bbfb',
          400: '#8096f8',
          500: '#6272f3',
          600: '#4f55e8',
          700: '#4244cf',
          800: '#3638a7',
          900: '#303584',
        },
      },
    },
  },
  plugins: [],
}

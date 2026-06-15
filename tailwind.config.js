/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand accent — Crystocraft Bespoke Gifting: deep burgundy / Garnet
        brand: {
          50:  '#fbf2f4',
          100: '#f5d8de',
          200: '#e9acb8',
          300: '#d97d8f',
          400: '#c05269',
          500: '#8b3347',
          600: '#6e2433',  // DS bespoke main — #6E2433
          700: '#5b1c29',
          800: '#501829',  // DS bespoke-dark
          900: '#380f1a',
        },
        // Foundation palette — Crystocraft Design System 2026
        ink: {
          DEFAULT: '#1C1C1A',
          95:      '#2A2A27',
          80:      '#444340',
          60:      '#6E6C66',
        },
        ivory: {
          DEFAULT: '#F7F4EF',
          dark:    '#EDE8DF',
          mid:     '#F2EEE7',
        },
        gold: {
          DEFAULT: '#C6A664',
          light:   '#D4B87A',
          dark:    '#A88D4F',
        },
        graphite: '#6E6C66',
        platinum: '#C9CBCC',
      },
      fontFamily: {
        sans:  ['Outfit', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Cormorant Garamond', 'Georgia', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
}

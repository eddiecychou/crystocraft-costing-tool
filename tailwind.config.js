/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand accent — Crystocraft Bespoke Gifting: deep burgundy / Garnet
        brand: {
          50:  '#f5f0f1',  // DS bespoke-bg
          100: '#f0e3e6',
          200: '#e2c2c9',
          300: '#cc94a0',
          400: '#a8556a',
          500: '#8b3347',  // DS bespoke-light
          600: '#6e2433',  // DS bespoke main — #6E2433
          700: '#5b1c29',
          800: '#501829',  // DS bespoke-dark
          900: '#380f1a',
        },
        // Foundation palette — Crystocraft Design System 2026 V2
        ink: {
          DEFAULT: '#222222',  // near-black — primary text, headings, dark sections
          95:      '#2E2E2C',
          80:      '#4A4A47',
          60:      '#666666',  // mid-grey — body copy
        },
        // "ivory" token kept for back-compat; now maps to V2 Beige warm bg
        ivory: {
          DEFAULT: '#F7EEE3',  // beige — warm section background
          dark:    '#EFE6D8',
          mid:     '#F2EAE0',
        },
        beige:       '#F7EEE3',
        'warm-grey': '#E9E8E6', // backgrounds, dividers, hairlines
        // Bronze — Gifts accent (available for highlights)
        bronze: {
          DEFAULT: '#996632',
          light:   '#B3824A',
          dark:    '#7A4F26',
        },
        // Champagne — premium metallic finish (foil, engraving)
        gold: {
          DEFAULT: '#C6A664',
          light:   '#D4BB82',
          dark:    '#A88D4F',
        },
        // Sapphire — Crystals accent
        sapphire: {
          DEFAULT: '#1C4F64',
          light:   '#2A6A84',
          dark:    '#163B4B',
        },
        graphite: '#666666',
        platinum: '#C9CBCC',
      },
      fontFamily: {
        // V2 — Questrial for headings + body, Work Sans for labels/eyebrows
        sans:  ['Questrial', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Questrial', 'system-ui', '-apple-system', 'sans-serif'],
        label: ['Work Sans', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

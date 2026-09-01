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
          80:      '#4A4A47',  // strong secondary
          70:      '#585853',  // mid secondary — AA on beige (6.2:1). Added V3.
          60:      '#666666',  // mid-grey — body copy / lightest AA-safe grey
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
      fontSize: {
        // V3 — the one tier below Tailwind's `text-xs` (12px). The app has
        // ~350 micro-labels (image overlays, status pills, dense-table
        // sub-text) that were hard-coded `text-[9..12px]`; they map here.
        // Not for body copy — badges/overlays/pills only.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px / 16px
      },
      // V2.5 — "restraint over decoration": near-flat elevation, reserved for
      // genuinely floating surfaces or a hover lift, never a resting card.
      // Redefines Tailwind's own shadow-* utility names (not new ones) so
      // every existing shadow-md/shadow-lg call site in the app picks up
      // the softer scale automatically, no per-file edits needed.
      boxShadow: {
        xs: '0 1px 2px rgba(34,34,34,0.04)',
        sm: '0 1px 3px rgba(34,34,34,0.05)',
        md: '0 4px 14px rgba(34,34,34,0.07)',
        lg: '0 10px 30px rgba(34,34,34,0.09)',
        xl: '0 20px 50px rgba(34,34,34,0.11)',
        '2xl': '0 36px 80px rgba(34,34,34,0.14)',
        bronze: '0 4px 20px rgba(153,102,50,0.20)',
        sapphire: '0 4px 20px rgba(28,79,100,0.20)',
        burgundy: '0 4px 20px rgba(110,36,51,0.20)',
      },
    },
  },
  plugins: [],
}

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  define: {
    // Stamped at build time so the app can show which build is live. The
    // version string alone can't tell you whether a deploy actually went out.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // No manualChunks: forcing @react-pdf / exceljs / @dnd-kit into named
  // chunks made Rollup link them from the entry (they were shared across
  // several lazy pages), so they modulepreload-ed on every page including
  // login. With the pages lazy() (App.jsx / Storefront.jsx) Rollup's own
  // splitting keeps those libs in async chunks that only load when a page
  // that needs them is opened.
})

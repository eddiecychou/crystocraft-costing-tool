import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  define: {
    // Stamped at build time so the app can show which build is live. The
    // version string alone can't tell you whether a deploy actually went out.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Self-heal stale tabs after a deploy. Every push rebuilds with new hashed
// chunk filenames (QuotePDF-<hash>.js etc.) — a tab left open across a
// deploy still holds references to the OLD hashes, so any lazy/dynamic
// import (PDF export, Excel export, any code-split route) 404s with
// "Failed to fetch dynamically imported module". Vite fires vite:preloadError
// for exactly this case; reload once to pick up the current build. Guarded
// by sessionStorage so a genuine, persistent failure (offline, real 404)
// shows the actual error instead of reload-looping forever.
window.addEventListener('vite:preloadError', () => {
  const key = 'vite-preload-reloaded'
  if (sessionStorage.getItem(key)) return // already tried once this session — don't loop
  sessionStorage.setItem(key, '1')
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

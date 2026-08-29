import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Self-heal stale tabs after a deploy. Every push rebuilds with new hashed
// chunk filenames (QuotePDF-<hash>.js etc.) — a tab left open across a
// deploy still holds references to the OLD hashes, so any lazy/dynamic
// import (PDF export, Excel export, any code-split route) 404s with
// "Failed to fetch dynamically imported module". Vite fires vite:preloadError
// for exactly this case; reload to pick up the current build.
//
// Guard is TIME-WINDOWED, not once-per-session: a genuine reload loop
// (offline, a real 404) re-fires within a second or two of the reload, so we
// suppress only that rapid repeat and show the real error. A second, third,
// … deploy later in the same long session is minutes/hours away, so it still
// self-heals — the old "once per session, forever" guard meant the 2nd stale
// chunk in a session showed a dead error dialog (owner hit this 2026-08-29).
window.addEventListener('vite:preloadError', () => {
  const KEY = 'vite-preload-reload-at'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last < 15000) return // just reloaded — real failure, let it surface
  sessionStorage.setItem(KEY, String(Date.now()))
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

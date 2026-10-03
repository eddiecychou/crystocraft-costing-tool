import { useState, useEffect } from 'react'

// In-memory session store so a page's working state (e.g. the WhatsApp import
// page's uploaded files + match/review selections + migration scan results)
// survives navigating away to other routes and back. React Router doesn't
// reload the SPA on route changes, so this module scope keeps the references —
// including File objects, which can't be JSON-serialised. A full browser
// refresh (F5) re-evaluates the module and clears it.
const store = {}

export function usePersistentState(key, initial) {
  const [state, setState] = useState(() => (key in store ? store[key] : initial))
  useEffect(() => { store[key] = state }, [key, state])
  return [state, setState]
}

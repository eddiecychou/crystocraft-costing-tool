import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

// Per-format config, keyed by format code (e.g. { moq: { '236': 100 },
// labels: { '236': 'Music Box' } }). Stored at settings/format_moq, edited in
// the admin Components → Format MOQs tab, and read by the storefront to flag the
// format-component MOQ on enquiries.
export function useFormatMoq() {
  const [data, setData] = useState({ moq: {}, labels: {} })
  useEffect(() => onSnapshot(doc(db, 'settings', 'format_moq'),
    s => {
      const d = s.exists() ? s.data() : {}
      setData({ moq: d.moq || {}, labels: d.labels || {} })
    },
    () => setData({ moq: {}, labels: {} })), [])
  return data
}

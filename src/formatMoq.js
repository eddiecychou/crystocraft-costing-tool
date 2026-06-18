import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

// Per-format minimum order quantities, keyed by format code (e.g. { '001': 100,
// '033': 100 }). Stored at settings/format_moq, edited in admin Settings, and
// read by the storefront to flag the format-component MOQ on enquiries.
export function useFormatMoq() {
  const [map, setMap] = useState({})
  useEffect(() => onSnapshot(doc(db, 'settings', 'format_moq'),
    s => setMap(s.exists() ? (s.data().moq || {}) : {}),
    () => setMap({})), [])
  return map
}

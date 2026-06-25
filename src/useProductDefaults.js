import { useState, useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

// Reads configurable production defaults from Firestore.
// Falls back to hardcoded values when the doc doesn't exist yet.
export function useProductDefaults() {
  const [defaults, setDefaults] = useState({ defaultPartsLeadWeeks: 6 })

  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'productDefaults'), snap => {
      if (!snap.exists()) return
      const d = snap.data()
      setDefaults({
        defaultPartsLeadWeeks: Number(d.default_parts_lead_weeks) || 6,
      })
    })
  }, [])

  return defaults
}

import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { RANGE_COMPONENT_CATEGORIES } from './constants'

// Editable component-category library — one settings doc holds the ordered list,
// edited in the admin Components → Categories tab and read by the component form
// dropdown. Mirrors crystalColors.js / formatMoq.js. Until the doc exists (or if
// it's emptied), we fall back to the built-in defaults so nothing ever renders an
// empty category picker.
const DOC_REF = () => doc(db, 'settings', 'component_categories')

export const DEFAULT_COMPONENT_CATEGORIES = RANGE_COMPONENT_CATEGORIES

const clean = list =>
  [...new Set((Array.isArray(list) ? list : []).map(s => (s || '').trim()).filter(Boolean))]

export function useComponentCategories() {
  const [categories, setCategories] = useState(DEFAULT_COMPONENT_CATEGORIES)
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(DOC_REF(),
    s => {
      const list = clean(s.exists() ? s.data().list : [])
      setCategories(list.length ? list : DEFAULT_COMPONENT_CATEGORIES)
      setLoading(false)
    },
    () => { setCategories(DEFAULT_COMPONENT_CATEGORIES); setLoading(false) },
  ), [])
  return { categories, loading }
}

export async function loadComponentCategories() {
  try {
    const s = await getDoc(DOC_REF())
    const list = clean(s.exists() ? s.data().list : [])
    return list.length ? list : DEFAULT_COMPONENT_CATEGORIES
  } catch {
    return DEFAULT_COMPONENT_CATEGORIES
  }
}

export async function saveComponentCategories(list) {
  await setDoc(DOC_REF(), { list: clean(list), updatedAt: serverTimestamp() }, { merge: true })
}

import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

// Shared Crystal Colour Library — a single settings doc holds the whole list.
// Shape: { colors: [{ code, name }], updatedAt }
// Order of the array = display order. Colours are an *attribute* of a variant
// (a multi-select), not a per-colour SKU — they don't affect stock or price.
// Price differences between colours are expressed by adding a separate variation
// (plating row) with its own price and assigning the dearer colours to it.
const DOC_REF = () => doc(db, 'settings', 'crystal_colors')

const norm = c => ({
  code: (c.code || '').trim().toUpperCase(),
  name: (c.name || '').trim(),
})

export async function loadCrystalColors() {
  try {
    const snap = await getDoc(DOC_REF())
    const arr = snap.exists() ? snap.data().colors : []
    return Array.isArray(arr) ? arr.map(norm).filter(c => c.code) : []
  } catch {
    return []
  }
}

export async function saveCrystalColors(colors) {
  const clean = (colors || []).map(norm).filter(c => c.code)
  // de-dupe by code, first wins
  const seen = new Set()
  const out = []
  for (const c of clean) {
    if (seen.has(c.code)) continue
    seen.add(c.code)
    out.push(c)
  }
  await setDoc(DOC_REF(), { colors: out, updatedAt: serverTimestamp() })
  return out
}

// Merge newly discovered codes into the library without disturbing existing
// entries (used by the collapse migration). Returns the merged list.
export async function ensureColors(codes) {
  const existing = await loadCrystalColors()
  const have = new Set(existing.map(c => c.code))
  const add = []
  for (const raw of codes) {
    const code = (raw || '').trim().toUpperCase()
    if (code && !have.has(code)) { have.add(code); add.push({ code, name: code }) }
  }
  if (!add.length) return existing
  return saveCrystalColors([...existing, ...add])
}

// React hook — loads once on mount.
export function useCrystalColors() {
  const [colors, setColors] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    loadCrystalColors().then(c => { if (alive) { setColors(c); setLoading(false) } })
    return () => { alive = false }
  }, [])
  return { colors, loading, setColors }
}

// Build a lookup code -> {code, name}
export const colorMap = colors => Object.fromEntries((colors || []).map(c => [c.code, c]))

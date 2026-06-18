import { createContext, useContext, useState, useEffect } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const sameItem = (a, t, id) => a.type === t && a.id === id

// A cart line is one orderable SKU: design + plating finish + crystal colour.
// Two variations of the same design are therefore distinct lines.
export const cartKey = i => `${i.type}:${i.id}:${i.finish || ''}:${i.color || ''}`

// ---- Enquiry cart (localStorage-backed) --------------------------------
const CartCtx = createContext(null)

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('cc_cart') || '[]')
      // Backfill keys for any lines saved before SKU-level keying existed.
      return raw.map(i => ({ ...i, key: i.key || cartKey(i) }))
    } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('cc_cart', JSON.stringify(items)) } catch {}
  }, [items])

  const add = item => setItems(prev => {
    const key = cartKey(item)
    if (prev.some(i => i.key === key)) return prev
    return [...prev, { qty: 1, note: '', ...item, key }]
  })
  const remove = key => setItems(prev => prev.filter(i => i.key !== key))
  const update = (key, patch) => setItems(prev => prev.map(i => i.key === key ? { ...i, ...patch } : i))
  const clear = () => setItems([])
  // has() accepts an item-like { type, id, finish, color }.
  const has = item => items.some(i => i.key === cartKey(item))

  return <CartCtx.Provider value={{ items, add, remove, update, clear, has, count: items.length }}>{children}</CartCtx.Provider>
}
export const useCart = () => useContext(CartCtx)

// ---- Favourites (Firestore favourites/{uid}) ---------------------------
const FavCtx = createContext(null)

export function FavouritesProvider({ uid, children }) {
  const [items, setItems] = useState([])
  useEffect(() => {
    if (!uid) return
    return onSnapshot(doc(db, 'favourites', uid),
      s => setItems(s.exists() ? (s.data().items || []) : []),
      () => setItems([]))
  }, [uid])

  const toggle = async item => {
    if (!uid) return
    const exists = items.some(i => sameItem(i, item.type, item.id))
    const next = exists
      ? items.filter(i => !sameItem(i, item.type, item.id))
      : [...items, { type: item.type, id: item.id, name: item.name, code: item.code || '', image: item.image || '' }]
    await setDoc(doc(db, 'favourites', uid), { items: next, updatedAt: serverTimestamp() }, { merge: true })
  }
  const has = (type, id) => items.some(i => sameItem(i, type, id))

  return <FavCtx.Provider value={{ items, toggle, has, count: items.length }}>{children}</FavCtx.Provider>
}
export const useFavourites = () => useContext(FavCtx)

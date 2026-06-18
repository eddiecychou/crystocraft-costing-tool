import { createContext, useContext, useState, useEffect } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

const sameItem = (a, t, id) => a.type === t && a.id === id

// ---- Enquiry cart (localStorage-backed) --------------------------------
const CartCtx = createContext(null)

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cc_cart') || '[]') } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('cc_cart', JSON.stringify(items)) } catch {}
  }, [items])

  const add = item => setItems(prev =>
    prev.some(i => sameItem(i, item.type, item.id)) ? prev : [...prev, { qty: 1, note: '', ...item }])
  const remove = (type, id) => setItems(prev => prev.filter(i => !sameItem(i, type, id)))
  const update = (type, id, patch) => setItems(prev => prev.map(i => sameItem(i, type, id) ? { ...i, ...patch } : i))
  const clear = () => setItems([])
  const has = (type, id) => items.some(i => sameItem(i, type, id))

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

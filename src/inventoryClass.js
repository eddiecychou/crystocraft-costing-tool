import { useState, useEffect } from 'react'
import {
  collection, doc, getDocs, setDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

// Generic "simple inventory class" (V7.13a DRY). Crystals and packaging are the
// same shape: a per-SKU master (code, name, one categorising attribute, size,
// cached stock_qty) that hangs off the shared stock ledger (stockLedger.js) and
// is consumed batch-per-order. This factory is the single implementation; each
// class is one config (crystals.js / packaging.js). The only per-class variation
// is the name of the categorising attribute field (`attrField` = 'colour' for
// crystals, 'type' for packaging) — kept as the real Firestore field name so no
// data migration is needed. Metal range_components is deliberately NOT built on
// this (it carries plating, supplier quotes, BOM links, MRP).

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }

// Shared paste parser for the stock-list importers. Each line:
//   code, [name…], qty   (tab or comma separated)
// code = first cell; qty = last purely-numeric cell; name = the cells between.
export function parseStockPaste(text) {
  const out = []
  for (const line of (text || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map(s => s.trim()).filter(Boolean)
    if (cells.length < 2) continue
    const code = cells[0].toUpperCase()
    // Needs a code-like first cell. A digit is required (every real code has
    // one); a letter is NOT — many JES-origin crystal codes are pure numeric
    // (e.g. "5186188"), and requiring a letter silently dropped every one of
    // them on import.
    if (!/\d/.test(code)) continue
    let qi = -1
    for (let i = cells.length - 1; i >= 1; i--) { if (/^[\d,]+(\.\d+)?$/.test(cells[i])) { qi = i; break } }
    if (qi === -1) continue
    const stock_qty = Number(cells[qi].replace(/,/g, ''))
    const name = cells.slice(1, qi).join(' ')
    out.push({ code, name, stock_qty })
  }
  return out
}

// Build the data API for one collection. `attrField` is the extra categorising
// attribute (kept as the real field name). Returns load / useItems / save /
// remove / importStock.
export function createInventoryClass({ collectionName, attrField }) {
  const COL = () => collection(db, collectionName)

  const normItem = c => ({
    code: (c.code || '').trim().toUpperCase(),
    name: (c.name || '').trim(),
    [attrField]: (c[attrField] || '').trim(),
    size: (c.size || '').trim(),
    notes: (c.notes || '').trim(),
    stock_qty: num(c.stock_qty),
  })
  const fromDoc = d => ({ id: d.id, ...d.data(), ...normItem(d.data()) })

  async function load() {
    try { return (await getDocs(query(COL(), orderBy('code')))).docs.map(fromDoc) }
    catch { return [] }
  }

  function useItems() {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    useEffect(() => {
      setLoading(true)
      const q = query(COL(), orderBy('code'))
      return onSnapshot(q,
        snap => { setItems(snap.docs.map(fromDoc)); setLoading(false) },
        () => { setItems([]); setLoading(false) },
      )
      // collectionName, NOT []. Each inventory class owns its own useItems, but
      // React matches hooks by POSITION, not by identity — so rendering
      // <InventoryStockTab inv={crystalInventory}/> and then
      // <InventoryStockTab inv={packagingInventory}/> in the same slot reuses
      // one instance, and with [] deps the effect never re-ran. The crystal
      // subscription survived into the Packaging Stock tab, which is why it
      // showed 180 crystals and 3,110,447 on hand. Reported 2026-07-21.
      //
      // collectionName is constant within a class, so this changes nothing for
      // a normal mount; it only fires when the hook is handed a different class.
    }, [collectionName])
    return { items, loading }
  }

  // Descriptive fields only — stock_qty is owned by the ledger, never written here.
  const descriptorOf = c => {
    const n = normItem(c)
    return { code: n.code, name: n.name, [attrField]: n[attrField], size: n.size, notes: n.notes }
  }

  async function save(id, data) {
    const payload = { ...descriptorOf(data), updatedAt: serverTimestamp() }
    if (id) { await setDoc(doc(db, collectionName, id), payload, { merge: true }); return id }
    const ref = await addDoc(COL(), { ...payload, createdAt: serverTimestamp() })
    return ref.id
  }

  async function remove(id) { await deleteDoc(doc(db, collectionName, id)) }

  // Idempotent stock-import: upsert SKUs by code and mirror every absolute count
  // into the ledger as a stocktake movement so the cached stock_qty and the
  // append-only history never diverge. Rows: [{ code, name, [attrField], size, stock_qty }].
  async function importStock(rows) {
    const norm = s => (s == null ? '' : String(s)).trim().toUpperCase()
    const clean = (rows || []).map(r => ({
      code: norm(r.code), name: (r.name || '').trim(),
      [attrField]: (r[attrField] || '').trim(), size: (r.size || '').trim(),
      stock_qty: num(r.stock_qty),
    })).filter(r => r.code)
    if (!clean.length) return { created: 0, updated: 0 }

    const byCode = {}
    for (const r of clean) {
      const c = byCode[r.code] || (byCode[r.code] = { code: r.code, name: '', [attrField]: '', size: '', stock_qty: null })
      if (r.name) c.name = r.name
      if (r[attrField]) c[attrField] = r[attrField]
      if (r.size) c.size = r.size
      if (r.stock_qty != null) c.stock_qty = r.stock_qty
    }

    const snap = await getDocs(COL())
    const existing = {}
    for (const d of snap.docs) {
      const code = norm(d.data().code)
      if (code && !(code in existing)) {
        const prev = d.data().stock_qty
        existing[code] = { id: d.id, hasName: !!(d.data().name || '').trim(), prevStock: Number.isFinite(prev) ? prev : 0 }
      }
    }

    const importDate = new Date().toISOString().slice(0, 10)
    let seq = Date.now()
    const stocktakeOp = (id, counted, prev) => ({
      ref: doc(collection(db, collectionName, id, 'movements')),
      data: {
        type: 'stocktake', qty: counted - prev, counted, balance_after: counted,
        date: importDate, note: 'Stock-take (list import)', order_id: null,
        seq: seq++, createdAt: serverTimestamp(),
      },
      merge: false,
    })

    const ops = []
    let created = 0, updated = 0
    for (const c of Object.values(byCode)) {
      const counted = Number.isFinite(c.stock_qty) ? c.stock_qty : null
      const ex = existing[c.code]
      if (ex) {
        const data = { [attrField]: c[attrField], size: c.size, updatedAt: serverTimestamp() }
        if (!ex.hasName && c.name) data.name = c.name
        if (counted != null) { data.stock_qty = counted; data.ledger_seeded = true; ops.push(stocktakeOp(ex.id, counted, ex.prevStock)) }
        ops.push({ ref: doc(db, collectionName, ex.id), data, merge: true })
        updated++
      } else {
        const ref = doc(COL())
        ops.push({ ref, data: {
          code: c.code, name: c.name, [attrField]: c[attrField], size: c.size, notes: '',
          stock_qty: counted, ledger_seeded: counted != null,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, merge: false })
        if (counted != null) ops.push(stocktakeOp(ref.id, counted, 0))
        created++
      }
    }

    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db)
      for (const op of ops.slice(i, i + 400)) batch.set(op.ref, op.data, { merge: op.merge })
      await batch.commit()
    }
    return { created, updated }
  }

  return { load, useItems, save, remove, importStock }
}

// Live UC# invoice registry (Firestore). Replaces the legacy "Invoice Check
// List" spreadsheet. The UC# is allocated atomically via a counter doc so two
// people can never grab the same number (the real upgrade over the shared Excel).
// Historical rows live read-only in Supabase (see the ERP Lookup "UC History"
// tab); THIS is the live, editable set.
import { useEffect, useState } from 'react'
import {
  collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp,
  runTransaction, getDocs,
} from 'firebase/firestore'
import { db, auth } from './firebase'

const COL = 'uc_invoices'
const COUNTER = () => doc(db, 'counters', 'uc')

export const UC_SOURCES = ['ERP', 'Alibaba', 'Amazon', 'Online Shop', 'Retail', 'Other']
export const UC_CURRENCIES = ['HKD', 'USD', 'EUR', 'GBP', 'RMB', 'CAD', 'AUD', 'JPY', 'MXN']

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const ucSeq = (uc) => { const m = /(\d+)/.exec(uc || ''); return m ? parseInt(m[1], 10) : 0 }

// Canonical write shape. Balance defaults to total − deposit unless set explicitly.
function normalize(d) {
  const total = num(d.total), deposit = num(d.deposit)
  const balance = (d.balance === '' || d.balance == null) ? Math.round((total - deposit) * 100) / 100 : num(d.balance)
  return {
    uc_no: (d.uc_no || '').trim(),
    year: (d.year || '').trim(),
    source: UC_SOURCES.includes(d.source) ? d.source : 'Other',
    jes_si: (d.jes_si || '').trim(),
    order_no: (d.order_no || '').trim(),
    customer: (d.customer || '').trim(),
    currency: (d.currency || '').trim(),
    total, deposit, balance,
    bal_pay_date: (d.bal_pay_date || '').trim(),
    shipment: (d.shipment || '').trim(),
    shipping_cost: num(d.shipping_cost),
    customs: (d.customs || '').trim(),
    delivery_date: (d.delivery_date || '').trim(),
    confirmed: !!d.confirmed,
    pic: (d.pic || '').trim(),
    remarks: (d.remarks || '').trim(),
    status: d.status === 'closed' ? 'closed' : 'open',
  }
}

// Allocate the next UC# and create the record atomically (no duplicate numbers).
export async function createUcInvoice(data) {
  const email = auth.currentUser?.email || null
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER())
    const next = (snap.exists() ? num(snap.data().value) : 0) + 1
    tx.set(COUNTER(), { value: next }, { merge: true })
    const ref = doc(collection(db, COL))
    tx.set(ref, { ...normalize({ ...data, uc_no: `UC${next}` }), created_at: serverTimestamp(), created_by: email })
    return { id: ref.id, uc_no: `UC${next}` }
  })
}

export async function updateUcInvoice(id, data) {
  await updateDoc(doc(db, COL, id), {
    ...normalize(data), updated_at: serverTimestamp(), updated_by: auth.currentUser?.email || null,
  })
}

// Live list, newest UC# first.
export function useUcInvoices() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, COL), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => ucSeq(b.uc_no) - ucSeq(a.uc_no))
      setItems(rows); setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [])
  return { items, loading }
}

// Raise the counter to at least `min` (so new UC#s continue above all history).
async function ensureCounterAtLeast(min) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER())
    const cur = snap.exists() ? num(snap.data().value) : 0
    if (cur < min) tx.set(COUNTER(), { value: min }, { merge: true })
  })
}

// One-time migration of the legacy open items. Idempotent: skips UC#s already
// present, and seeds the counter to 4948 so the next NEW record is UC4949.
export async function seedOpenItems(seed) {
  const existing = new Set((await getDocs(collection(db, COL))).docs.map((d) => d.data().uc_no))
  let added = 0
  for (const rec of seed) {
    if (existing.has(rec.uc_no)) continue
    await addDoc(collection(db, COL), {
      ...normalize(rec), created_at: serverTimestamp(), created_by: 'migration', migrated: true,
    })
    added += 1
  }
  await ensureCounterAtLeast(4948)
  return added
}

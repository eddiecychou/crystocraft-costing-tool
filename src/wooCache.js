// Persisted cache of the WooCommerce API pulls, so WooCommerceSync.jsx and
// WooStockReconcile.jsx restore the last fetch on open instead of calling
// WooCommerce every visit. "Refresh" on either page refetches and overwrites.
//
// It is a PURE CACHE — nothing downstream reads `woo_cache`, wiping it only
// forces a refetch. Admin-only (firestore.rules `woo_cache/{doc}`), matching
// the `woo` module.
//
// Firestore caps a document at ~1 MiB. A large catalogue or a wide order
// range can approach that, so every save serialises first and silently skips
// the write (returning { skipped:'too_large' }) rather than throwing — the
// page still has the data in memory for the session, it just won't persist.
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

const MAX_BYTES = 900_000
const ref = (name) => doc(db, 'woo_cache', name)

// Firestore Timestamp | Date | undefined  →  Date | null
const toDate = (v) => (typeof v?.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)

async function save(name, payload) {
  const bytes = new Blob([JSON.stringify(payload)]).size
  if (bytes > MAX_BYTES) return { skipped: 'too_large', bytes }
  await setDoc(ref(name), { ...payload, fetched_at: serverTimestamp() })
  return { ok: true, bytes }
}

async function load(name) {
  try {
    const snap = await getDoc(ref(name))
    if (!snap.exists()) return null
    const d = snap.data()
    return { ...d, fetchedAt: toDate(d.fetched_at) }
  } catch {
    return null
  }
}

// ── product catalogue + per-variation stock (WooStockReconcile) ─────────────
export const loadWooCatalogueCache = () => load('product_catalogue')
export const saveWooCatalogueCache = (rows) =>
  save('product_catalogue', { rows, row_count: rows.length })

// ── catalogue overview: product-shaped rows + SEO fields (WooCatalogue) ─────
export const loadWooCatalogueOverviewCache = () => load('catalogue_overview')
export const saveWooCatalogueOverviewCache = (rows) =>
  save('catalogue_overview', { rows, row_count: rows.length })

// ── order sync result, keyed by the date range it was fetched for ──────────
export const loadWooOrdersCache = () => load('orders')
export const saveWooOrdersCache = (from, to, result) =>
  save('orders', {
    from, to,
    rows: result.rows || [],
    refunds: result.refunds || [],
    skipped_unpaid: result.skipped_unpaid ?? 0,
    total_fetched: result.total_fetched ?? 0,
  })

// ── "Scan order history" → classified retail-buyer list (WooCommerceSync) ───
// The all-time paid-order scan is the most expensive call on the page. The
// classification (new / possible B2B match / linked) can drift after "Create
// retail customers", but createWooRetailCustomers is an idempotent merge that
// skips 'linked', so a stale 'new' is a cosmetic count until the next scan,
// not a double-create. `matchedContact` is trimmed to its id before saving —
// the full lead doc is only needed live.
export const loadWooCustomerScanCache = () => load('customer_scan')
export const saveWooCustomerScanCache = (rows) =>
  save('customer_scan', {
    rows: (rows || []).map((e) => {
      const m = e.matchedContact
      return m ? { ...e, matchedContact: { id: m.id, first_name: m.first_name ?? null, company: m.company ?? null } } : e
    }),
    row_count: (rows || []).length,
  })

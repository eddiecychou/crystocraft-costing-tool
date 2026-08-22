// WooCommerce Retail Customer bulk sync (2026-08-22) — "sync everyone who has
// actually transacted with us" (owner). Deliberately derived from PAID ORDER
// HISTORY, not WooCommerce's own /customers (registered-account) endpoint:
// the owner doesn't yet trust that list for spam/quality, and a guest
// checkout — very common on a B2C storefront — has no account there at all,
// so it would miss real buyers. Scanning orders instead is complete for both.
//
// Same safety guarantees as the single-record linking flow (wooImport.js):
//   - Idempotent, deterministic doc ID — re-running the scan/create is safe.
//   - NEVER auto-merges with an existing B2B customer on email match — flags
//     `possible_b2b_match` for review instead, same field shape as
//     marketing_contacts.possible_customer_match elsewhere in this app.
//   - NEVER touches marketing_contacts, never assumes marketing consent.
import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { idFromEmail, linkContactToCustomer } from './domain/marketingContact'
import { wooOrdersPage } from './wooSyncApi'

// Same "-cust-<id>" / "-guest-<email>" split as a real WooCommerce account
// vs. a guest checkout — a guest has no stable WooCommerce identity beyond
// the email they typed, so that IS their identity here.
export const wooCustomerDocId = (wooCustomerId, email) =>
  wooCustomerId ? `woo-cust-${wooCustomerId}` : `woo-guest-${idFromEmail(email)}`

// Scans ALL-TIME paid order history, page by page (client-driven — see
// woo-sync.js's orders_page op for why), aggregating one entry per unique
// person. `onProgress(pagesScanned, ordersScanned, uniqueCount)` is called
// after every page so the UI can show live progress across what may be a
// long scan. Returns an array of:
//   { key, wooCustomerId, email, name, orderCount, totalsByCurrency,
//     firstDate, lastDate }
export async function scanWooCustomers(onProgress) {
  const byKey = new Map()
  let page = 1, ordersScanned = 0
  for (;;) {
    const { rows, has_more } = await wooOrdersPage(page)
    ordersScanned += rows.length
    for (const o of rows) {
      if (!o.email && !o.woo_customer_id) continue // nothing to identify them by — skip
      const key = wooCustomerDocId(o.woo_customer_id, o.email)
      const entry = byKey.get(key) || {
        key, wooCustomerId: o.woo_customer_id, email: o.email, name: o.name,
        orderCount: 0, totalsByCurrency: {}, firstDate: o.date_paid, lastDate: o.date_paid,
      }
      entry.orderCount += 1
      entry.totalsByCurrency[o.currency] = (entry.totalsByCurrency[o.currency] || 0) + o.total
      if (o.date_paid < entry.firstDate) entry.firstDate = o.date_paid
      if (o.date_paid > entry.lastDate) entry.lastDate = o.date_paid
      if (o.name) entry.name = o.name // most recent order's name wins — a typo'd earlier order shouldn't stick
      byKey.set(key, entry)
    }
    onProgress?.(page, ordersScanned, byKey.size)
    if (!has_more) break
    page += 1
  }
  return [...byKey.values()]
}

// Classifies each scanned entry against the FULL existing customer list
// (already loaded once by the caller — loadCustomers() from domain/customer,
// no extra reads needed): 'linked' (a customer doc already exists at this
// entry's deterministic ID — re-running the scan is a no-op for them),
// 'possible_match' (a DIFFERENT, non-WooCommerce customer shares this email
// — flag, never auto-merge), or 'new'. ALSO checks whether the person
// already exists as a marketing_contacts LEAD — a direct doc-ID lookup
// (marketing_contacts is keyed by idFromEmail, same as saveContact/
// linkContactToCustomer already assume), not a collection scan. This is
// checking a match for an EXISTING lead, never creating a new one — the
// "don't put WooCommerce buyers into Marketing Leads" rule is about not
// authoring new lead records, not about ignoring one that's already there.
export async function classifyWooCustomers(entries, existingCustomers) {
  const existingIds = new Set(existingCustomers.map(c => c.id))
  const emailIndex = new Map()
  for (const c of existingCustomers) {
    if (c.source === 'WooCommerce') continue // only B2B/other-channel customers are a "possible match" target
    for (const email of (c.contact_emails || [])) {
      if (email) emailIndex.set(email.trim().toLowerCase(), c)
    }
  }
  return Promise.all(entries.map(async e => {
    const contactSnap = e.email ? await getDoc(doc(db, 'marketing_contacts', idFromEmail(e.email))) : null
    const matchedContact = contactSnap?.exists() ? { id: contactSnap.id, ...contactSnap.data() } : null

    if (existingIds.has(e.key)) return { ...e, status: 'linked', matchedContact }
    const match = e.email ? emailIndex.get(e.email) : null
    return match
      ? { ...e, status: 'possible_match', possibleMatch: { customer_id: match.id, company_name: match.company_name }, matchedContact }
      : { ...e, status: 'new', matchedContact }
  }))
}

function buildRetailCustomerDoc(e) {
  const contact = e.email ? [{
    id: 'primary', name: e.name || '', title: '', email: e.email, phone: '',
    whatsapp: '', whatsapp_personal: '', whatsapp_business: '', wechat: '', address: '', is_primary: true,
  }] : []
  return {
    company_name: e.name || e.email || 'Unknown (WooCommerce)',
    contacts: contact,
    contact_name: e.name || '',
    contact_emails: e.email ? [e.email] : [],
    source: 'WooCommerce',
    customer_type: 'retail',
    tags: ['Retail Customer'],
    crm_status: 'Active',
    woo_customer_id: e.wooCustomerId || null,
    possible_b2b_match: e.possibleMatch || null,
    notes: `Synced from WooCommerce order history — ${e.orderCount} order${e.orderCount === 1 ? '' : 's'}, `
      + `${e.firstDate?.slice(0, 10)} to ${e.lastDate?.slice(0, 10)}.`,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }
}

// Creates customer docs for every entry NOT already 'linked' (covers both
// 'new' and 'possible_match' — a possible match still gets its own retail
// record, just flagged for review; it is never merged into the matched
// customer). `{ merge: true }` makes this safe to re-run.
//
// After each batch commits, any entry with a `matchedContact` (an EXISTING
// marketing_contacts lead sharing this email, found by classifyWooCustomers)
// gets linked via the same linkContactToCustomer() the rest of the app
// already uses for "a lead converted to a customer" — stamps
// is_customer/possible_customer_match on the lead and
// linked_marketing_contact_ids on the new customer, so engagement/reply
// history follows the person instead of staying stranded under the lead
// record. linkContactToCustomer requires the customer doc to already exist
// (it calls updateDoc, which throws on a missing doc), hence AFTER the
// batch commit, not inside it.
export async function createWooRetailCustomers(entries) {
  const targets = entries.filter(e => e.status !== 'linked')
  for (let i = 0; i < targets.length; i += 400) {
    const chunk = targets.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const e of chunk) {
      batch.set(doc(db, 'customers', e.key), buildRetailCustomerDoc(e), { merge: true })
    }
    await batch.commit()
    await Promise.all(chunk
      .filter(e => e.matchedContact)
      .map(e => linkContactToCustomer(e.matchedContact.id, e.key, e.name || e.email).catch(() => {})))
  }
  return targets.length
}

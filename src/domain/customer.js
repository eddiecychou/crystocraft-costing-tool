import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, where, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { str, cleanArray, result, addError, addWarning } from './validation'

// Canonical Customer module — the customers collection previously had NO domain
// module: CustomerForm and ShipmentForm built payloads inline and read/wrote
// Firestore directly, each with its own legacy-alias handling. This centralizes
// the one canonical shape (spec: product-manager-guardrail-spec.md §Customer).
//
//   - company_name is the ONLY canonical name field (legacy `name` is folded in
//     on read but never written back).
//   - country folds legacy `region`; channels[] folds legacy `primary_channel`;
//     contact_emails/phones/whatsapps[] fold the legacy scalar fields.
//   - Reads go through loadCustomers/useCustomers/normalizeCustomer so the alias
//     folding happens in one place; writes go through saveCustomer (normalize →
//     validate → write).

const COL = () => collection(db, 'customers')

// Canonical enum vocabularies (single source — CustomerForm imports these too).
export const CRM_STATUSES   = ['Active', 'Prospect', 'Dormant', 'Inactive']
export const CRM_CATEGORIES = ['Distributor', 'Small B2B', 'Gift / OEM', 'Crystal Fabric']
export const CHANNELS       = ['Email', 'WhatsApp Business', 'Alibaba', 'Personal WhatsApp', 'WeChat']
// Channels with no API/integration behind them yet — every interaction on
// these is manually typed in by an admin (no live sync, unlike Email). Used
// to label channel pickers everywhere they appear so it's clear which
// channels the app can't see into on its own. WhatsApp Business here means
// the consumer WhatsApp Business *app*, not the Business Platform API — see
// PROJECT-PLAN.md's "Where V8.2 starts" entry.
export const NO_API_CHANNELS = ['WhatsApp Business', 'Personal WhatsApp', 'WeChat']
export const CUSTOMER_SOURCES = ['Alibaba', 'Website', 'Email Marketing', 'Referral', 'Trade Show', 'BNI', 'Direct']

// Retail flag (V8.2, owner request) — NOT a Retail/Wholesale pair. Most
// customers here are trade/wholesale by default and stay unlabeled; only
// the minority who buy at retail/individual pricing get tagged. Real
// sources of a retail customer, per the owner (2026-08-12): promoted from
// Marketing Contacts or the public online shop (www.crystocraft.com,
// WooCommerce — not yet synced to this app, see PROJECT-PLAN.md's "Where
// V8.2 starts"), OR an existing trade-bucket customer (e.g. shared ERP code
// C13) who ALSO buys cash/retail sometimes, invoiced through the portal by
// FPS/PayPal instead of going through the website — so this has to stay a
// plain manual tag, not something inferred once and locked in.
// "Retail Customer" (not "Retail" — plenty of existing customers already
// carry a free-typed "Retail" tag meaning their own business is IN the
// retail industry, a completely different meaning; reusing that string
// would collide two unrelated facts onto one tag).
export const RETAIL_TAG = 'Retail Customer'

// Country picker — single source (previously duplicated, and drifted, between
// Customers.jsx's filter dropdown and CustomerForm.jsx's search combobox).
// Base list plus everywhere a real customer or marketing contact is on record
// (checked against both collections, 2026-07-29) that wasn't already covered —
// Pakistan/Estonia/Latvia/Lithuania/Belarus (asked for) and the rest ordered by
// how many contacts are there (Cyprus 15, Israel 14, Greece 13, Turkey 11, down
// to Serbia 2). Left out: spelling variants of countries already in the list
// (Macao, Brasil, România, Scotland) and "Republic of Dominica", which is Dominican
// Republic misremembered — the correct name is included instead.
export const CUSTOMER_COUNTRIES = [
  'Albania', 'Algeria', 'Argentina', 'Australia', 'Austria',
  'Belarus', 'Belgium', 'Brazil', 'Bulgaria',
  'Cambodia', 'Canada', 'Chile', 'China (Mainland)', 'Colombia', 'Croatia', 'Cyprus', 'Czech Republic',
  'Denmark', 'Dominican Republic',
  'Ecuador', 'Egypt', 'Estonia',
  'Finland', 'France',
  'Germany', 'Greece',
  'Honduras', 'Hong Kong', 'Hungary',
  'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Japan',
  'Kazakhstan', 'Kenya', 'Kuwait',
  'Latvia', 'Lebanon', 'Libya', 'Lithuania', 'Luxembourg',
  'Macau', 'Malaysia', 'Maldives', 'Mauritania', 'Mauritius', 'Mexico', 'Moldova', 'Mongolia', 'Morocco', 'Myanmar',
  'Netherlands', 'New Zealand', 'Nigeria', 'Norway',
  'Oman',
  'Pakistan', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar',
  'Romania', 'Russia',
  'Saudi Arabia', 'Serbia', 'Singapore', 'Slovakia', 'Slovenia', 'South Africa', 'South Korea',
  'Spain', 'Sri Lanka', 'Sweden', 'Switzerland',
  'Taiwan', 'Thailand', 'Tunisia', 'Turkey',
  'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uzbekistan',
  'Venezuela', 'Vietnam',
  'Other',
]

// Array from a canonical array field, falling back to a legacy scalar field.
const arrFrom = (arrVal, scalarVal) => {
  if (Array.isArray(arrVal) && arrVal.length) return cleanArray(arrVal)
  const s = str(scalarVal)
  return s ? [s] : []
}

// Channels[] with legacy single primary_channel folded in.
const channelsOf = i =>
  (Array.isArray(i.channels) && i.channels.length) ? cleanArray(i.channels)
    : (str(i.primary_channel) ? [str(i.primary_channel)] : [])

// ── Contacts ─────────────────────────────────────────────────────────────────
// A customer's contacts are separate NAMED people (owner, 2026-08-05: several
// real contacts within one company deserve to stay distinct, not merged into
// one "contact_name + a pile of un-attributed emails" blob). Each contact has
// its own single email/phone/whatsapp/wechat — a real person has one of each,
// not an ambiguous shared list nobody can attribute. `address` is an
// OPTIONAL per-contact override — different departments in the same company
// can genuinely sit in different offices; blank means "same as the company
// address" (see contactAddress() below), which is the common case.
const genContactId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function normalizeContact(c) {
  return {
    id: str(c?.id) || genContactId(),
    name: str(c?.name),
    title: str(c?.title),
    email: str(c?.email),
    phone: str(c?.phone),
    whatsapp: str(c?.whatsapp),
    wechat: str(c?.wechat),
    address: str(c?.address),
    is_primary: !!c?.is_primary,
  }
}

// contacts[] with the legacy scalar/array contact fields folded in as ONE
// synthesized contact when no contacts[] exists yet. A legacy record's
// several un-attributed emails can't be safely split into distinct people —
// nothing on the old record says which belongs to whom — so they collapse
// onto that one contact's own email; an admin splits them apart by hand once
// they know who's who. Never emits more than one contact for a legacy record.
// The synthesized contact's address is left blank (not copied from the
// customer's own address) so contactAddress() falls back to the company
// address exactly as it always effectively did before contacts existed.
export function contactsOf(r) {
  if (Array.isArray(r.contacts) && r.contacts.length) {
    const list = r.contacts.map(normalizeContact)
    if (!list.some(c => c.is_primary)) list[0].is_primary = true
    return list
  }
  const name = str(r.contact_name)
  const email = arrFrom(r.contact_emails, r.contact_email)[0] || ''
  const phone = arrFrom(r.contact_phones, r.contact_phone)[0] || ''
  const whatsapp = arrFrom(r.contact_whatsapps, r.whatsapp)[0] || ''
  const wechat = cleanArray(r.contact_wechats)[0] || ''
  if (!name && !email && !phone && !whatsapp && !wechat) return []
  return [{ id: 'legacy', name, title: '', email, phone, whatsapp, wechat, address: '', is_primary: true }]
}

export const primaryContact = list => (list || []).find(c => c.is_primary) || (list || [])[0] || null

// The address to use for a specific contact — their own if they have one set,
// otherwise the company's. Both quotes and orders resolve through this so
// "address a document to contact X" does the sensible thing whether or not
// that contact happens to have their own office on file.
export const contactAddress = (contact, customer) => contact?.address || customer?.address || ''

// Raw Firestore doc (or form state) → canonical customer object. READ shape:
// returns only canonical fields, with every legacy alias folded in. Never emits
// legacy keys (`name`, `region`, `primary_channel`).
export function normalizeCustomer(raw) {
  const r = raw || {}
  const contacts = contactsOf(r)
  const primary = primaryContact(contacts)
  return {
    company_name:      str(r.company_name || r.name),     // fold legacy `name`
    contacts,
    // Derived mirrors of the PRIMARY contact — kept so anything not yet
    // reading contacts[] (print pages, the ERP customer import, marketing-
    // contact conversion) keeps working unchanged. Never the source of truth
    // once contacts[] exists; always max one entry now (a real per-contact
    // value, not an unattributed pile).
    contact_name:      primary?.name || '',
    contact_emails:    primary?.email ? [primary.email] : [],
    contact_phones:    primary?.phone ? [primary.phone] : [],
    contact_whatsapps: primary?.whatsapp ? [primary.whatsapp] : [],
    contact_wechats:   primary?.wechat ? [primary.wechat] : [],
    website:           str(r.website),
    address:           str(r.address),
    country:           str(r.country || r.region),        // fold legacy `region`
    crm_category:      str(r.crm_category),
    crm_status:        str(r.crm_status),
    channels:          channelsOf(r),
    source:            str(r.source),
    segment:           str(r.segment),
    erp_code:          str(r.erp_code),
    // Computed + persisted at save time (saveCustomer) — see
    // mirrorToLinkedAccounts's comment. Read-only elsewhere: never accept
    // this from a form, it's not something an admin sets directly.
    erp_code_shared:   !!r.erp_code_shared,
    tags:              cleanArray(r.tags),
    is_vip:            !!r.is_vip,
    is_personal_wa:    !!r.is_personal_wa,
    sensitive:         !!r.sensitive,
    notes:             str(r.notes),
    folder_path:       str(r.folder_path),
    last_contacted:    r.last_contacted ?? null,
    // Daily Drafts outreach engine (V7.23): lastOutreachAt is set only on an
    // actual send (send-personal-email.js), never on draft generation.
    // blockOutreachUntil is a manual "don't suggest this customer" flag — set
    // far in the future for an indefinite block, or to a specific date; also
    // covers "temporarily pause" without a separate boolean.
    lastOutreachAt:      r.lastOutreachAt ?? null,
    blockOutreachUntil:  r.blockOutreachUntil ?? null,
    createdAt:         r.createdAt ?? null,
    updatedAt:         r.updatedAt ?? null,
    // V8.1 email ingestion (Phase 2) — a DeepSeek-generated draft over
    // customers/{id}/email_threads, written by refresh-email-summary.js via
    // CustomerDetail.jsx's "Refresh" action. Never set by anything else;
    // pass through as-is rather than reconstructing its shape here.
    email_summary:     r.email_summary ?? null,
  }
}

// Validate against the canonical contract. Returns the shared result format
// ({ ok, errors, warnings, infos }) with machine-readable codes. The
// company_name/name distinction is checked on the RAW input (normalize folds
// `name` into company_name, which would otherwise hide a legacy-only record).
export function validateCustomer(input) {
  const r = result()
  const rawCompany = str(input?.company_name)
  const rawName    = str(input?.name)
  if (!rawCompany) {
    if (rawName) addWarning(r, 'customer.companyname.legacy', 'company_name',
      "has legacy `name` but no `company_name` — won't appear in dropdowns/queries")
    else addError(r, 'customer.companyname.required', 'company_name',
      'Company name is required')
  }
  const c = normalizeCustomer(input)
  if (c.crm_status && !CRM_STATUSES.includes(c.crm_status))
    addWarning(r, 'customer.crmstatus.unknown', 'crm_status', `Unknown CRM status "${c.crm_status}"`)
  if (c.crm_category && !CRM_CATEGORIES.includes(c.crm_category))
    addWarning(r, 'customer.crmcategory.unknown', 'crm_category', `Unknown customer type "${c.crm_category}"`)
  return r
}

// The persisted document shape. Matches exactly the field set the customer form
// has always written (so updateDoc never clobbers fields it doesn't manage, e.g.
// folder_path / segment / last_contacted), but normalized + with denormalized
// scalar mirrors (contact_email/phone, whatsapp, primary_channel) kept in sync
// for any consumer not yet routed through normalizeCustomer. Never writes `name`.
function toCustomerDoc(input) {
  const i = input || {}
  const channels  = channelsOf(i)
  // contacts[] is the canonical source now. Accept it directly if the caller
  // supplies it (CustomerForm does); otherwise fold in whatever legacy scalar
  // fields are present, same as the read path — keeps saveCustomer safe to
  // call from anything not yet updated to the contacts[] shape.
  const contacts = Array.isArray(i.contacts) ? i.contacts.map(normalizeContact) : contactsOf(i)
  if (contacts.length && !contacts.some(c => c.is_primary)) contacts[0].is_primary = true
  const primary = primaryContact(contacts)
  return {
    company_name:  str(i.company_name || i.name),
    contacts,
    // Denormalized mirrors of the primary contact — kept in sync for any
    // consumer not yet routed through contacts[] (print pages, ERP import).
    contact_name:  primary?.name || '',
    erp_code:      str(i.erp_code),
    website:       str(i.website),
    country:       str(i.country || i.region),
    address:       str(i.address),
    notes:         str(i.notes),
    crm_category:  str(i.crm_category),
    source:        str(i.source),
    crm_status:    str(i.crm_status),
    tags:          cleanArray(i.tags),
    channels,
    primary_channel: channels[0] || '',           // denormalized mirror (compat)
    is_personal_wa: !!i.is_personal_wa,
    is_vip:         !!i.is_vip,
    sensitive:      !!i.sensitive,                // was accepted from CustomerForm but never persisted — fixed 2026-08-05
    contact_emails:    primary?.email ? [primary.email] : [],
    contact_phones:    primary?.phone ? [primary.phone] : [],
    contact_whatsapps: primary?.whatsapp ? [primary.whatsapp] : [],
    contact_wechats:   primary?.wechat ? [primary.wechat] : [],
    contact_email: primary?.email || '',          // denormalized mirror (compat)
    contact_phone: primary?.phone || '',          // denormalized mirror (compat)
    whatsapp:      primary?.whatsapp || '',       // denormalized mirror (compat)
  }
}

// Create (id null/undefined) or update a customer. Normalizes then validates
// before any write. On a validation error nothing is written and the result is
// returned so the caller can surface it. Returns { ok, id, result } — `result`
// carries warnings even on success.
export async function saveCustomer(id, input) {
  const v = validateCustomer(input)
  if (!v.ok) return { ok: false, id: id || null, result: v }
  const payload = { ...toCustomerDoc(input), updatedAt: serverTimestamp() }
  let savedId = id
  if (id) {
    const erp_code = payload.erp_code || ''
    // A few JES codes (A29, C13, O07 — confirmed 2026-08-07) are shared
    // "bucket" codes used for many different Alibaba/website/walk-in
    // customers, not unique per customer. Computed here (not trusted from
    // the client) so it's honest wherever it's read — the order-history
    // edge function refuses to return JES history when this is true, same
    // guard CustomerDetail.jsx's admin view already applies.
    let erp_code_shared = false
    if (erp_code) {
      const shareSnap = await getDocs(query(collection(db, 'customers'), where('erp_code', '==', erp_code)))
      erp_code_shared = shareSnap.size > 1
    }
    await updateDoc(doc(db, 'customers', id), { ...payload, erp_code_shared })
    await mirrorToLinkedAccounts(id, { sensitive: payload.sensitive, erp_code, erp_code_shared })
  } else {
    const ref = await addDoc(COL(), { ...payload, createdAt: serverTimestamp() })
    savedId = ref.id
  }
  return { ok: true, id: savedId, result: v }
}

// `sensitive` gates what a logged-in customer's own storefront browsing shows
// them (CorporateShop.jsx screens a competitor-branded hero image); `erp_code`
// is what the portal order-history feature needs to ask the ERP-history edge
// function "which JES customer am I" (see netlify/edge-functions/
// customer-order-history.js). Neither can be read off customers/{id} directly
// — that doc is admin-only — so both are mirrored onto every users/{uid} doc
// linked to this customer, which the signed-in user CAN already read (their
// own doc). Cheap: a customer normally has one or a few linked accounts.
async function mirrorToLinkedAccounts(customerId, { sensitive, erp_code, erp_code_shared }) {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('customer_id', '==', customerId)))
    if (snap.empty) return
    const batch = writeBatch(db)
    snap.forEach(d => batch.update(d.ref, { sensitive: !!sensitive, erp_code: erp_code || '', erp_code_shared: !!erp_code_shared }))
    await batch.commit()
  } catch { /* best-effort mirror — a stale flag is a screening gap, not a crash */ }
}

const fromDoc = d => ({ id: d.id, ...normalizeCustomer(d.data()), _raw: d.data() })

// All customers, sorted by company_name. NOTE: we deliberately do NOT use a
// Firestore orderBy('company_name') here — that silently drops any doc missing
// the field (the legacy-`name`-only bug). We fetch unordered and sort the
// normalized name client-side so every customer appears in dropdowns/lists.
export async function loadCustomers() {
  try {
    const snap = await getDocs(COL())
    return snap.docs.map(fromDoc).sort((a, b) => a.company_name.localeCompare(b.company_name))
  } catch {
    return []
  }
}

export async function getCustomer(id) {
  const snap = await getDoc(doc(db, 'customers', id))
  return snap.exists() ? fromDoc(snap) : null
}

// ── Merging two duplicate customer records ──────────────────────────────────
// The survivor is the record you choose to keep; the duplicate is deleted.
// Conflict rule: survivor wins, fill gaps only — a blank field on the survivor
// is filled from the duplicate, array fields are unioned (never dropped), and a
// boolean flag OR's (a true on either side survives). Nothing on the survivor
// that already has a value is ever overwritten.
// contact_name/contact_emails/contact_phones/contact_whatsapps/contact_wechats
// are DERIVED from contacts[] now (see normalizeCustomer) — merging them here
// would just be re-deriving stale values, so they're deliberately absent from
// these lists. contacts[] itself is merged by mergeContactLists() below.
const MERGE_SCALAR_FIELDS = [
  'website', 'address', 'country',
  'crm_category', 'crm_status', 'source', 'segment', 'erp_code', 'notes', 'folder_path',
]
const MERGE_ARRAY_FIELDS = ['tags', 'channels']
const MERGE_BOOL_FIELDS = ['is_vip', 'is_personal_wa', 'sensitive']

function unionArrays(a, b) {
  const seen = new Set(); const out = []
  for (const v of [...(a || []), ...(b || [])]) {
    const k = String(v).trim().toLowerCase()
    if (k && !seen.has(k)) { seen.add(k); out.push(v) }
  }
  return out
}

// Union two contact lists, treating the same email (or, failing that, the
// same name) as the same person so a contact already on the survivor isn't
// duplicated. The survivor's own contacts are never altered or dropped; only
// genuinely new people are appended, and never as a second primary — the
// survivor's existing primary (or, if it had none, the first contact) stays
// primary.
function mergeContactLists(survivorContacts, duplicateContacts) {
  const survivor = survivorContacts || []
  const out = [...survivor]
  const seenEmails = new Set(survivor.map(c => c.email.toLowerCase()).filter(Boolean))
  const seenNames = new Set(survivor.map(c => c.name.toLowerCase()).filter(Boolean))
  for (const c of (duplicateContacts || [])) {
    const emailKey = c.email.toLowerCase()
    const nameKey = c.name.toLowerCase()
    const isSamePerson = (emailKey && seenEmails.has(emailKey)) || (!emailKey && nameKey && seenNames.has(nameKey))
    if (isSamePerson) continue
    out.push({ ...normalizeContact(c), is_primary: false })
    if (emailKey) seenEmails.add(emailKey)
    if (nameKey) seenNames.add(nameKey)
  }
  if (out.length && !out.some(c => c.is_primary)) out[0].is_primary = true
  return out
}

// What would change on the survivor if merged with the duplicate — the fields
// to write, so the UI can show "X will gain: …" before anyone commits to it.
function fieldsToFillFrom(survivor, duplicate) {
  const out = {}
  for (const f of MERGE_SCALAR_FIELDS) {
    if (!str(survivor[f]) && str(duplicate[f])) out[f] = duplicate[f]
  }
  for (const f of MERGE_ARRAY_FIELDS) {
    const merged = unionArrays(survivor[f], duplicate[f])
    if (merged.length !== (survivor[f] || []).length) out[f] = merged
  }
  for (const f of MERGE_BOOL_FIELDS) {
    if (!survivor[f] && duplicate[f]) out[f] = true
  }
  const mergedContacts = mergeContactLists(survivor.contacts, duplicate.contacts)
  if (mergedContacts.length !== (survivor.contacts || []).length) out.contacts = mergedContacts
  return out
}

// The three collections that reference a customer by id — everything a merge
// has to repoint. (favourites/customer_designs/the TOP-LEVEL enquiries
// collection key on the portal login's own uid, not customer_id, so a
// customer merge doesn't touch them. That does NOT extend to
// customers/{id}/enquiries — the CRM Interaction Log — which is a different
// collection entirely, keyed by the customer's own path; see
// interactionDocs() below, found missing 2026-08-05.)
async function relatedDocs(customerId) {
  const [ordersSnap, quotesSnap, usersSnap] = await Promise.all([
    getDocs(query(collection(db, 'orders'), where('customer_id', '==', customerId))),
    getDocs(query(collection(db, 'client_quotes'), where('customer_id', '==', customerId))),
    getDocs(query(collection(db, 'users'), where('customer_id', '==', customerId))),
  ])
  return { ordersSnap, quotesSnap, usersSnap }
}

// Product images tagged "branded for" this customer (Customer Brand Gallery
// amendments, V7.21 — see firestore.rules viewerIsSensitive()). Iterates each
// product's own images subcollection rather than a collectionGroup query
// deliberately: a collectionGroup equality filter needs a manually-created
// composite index, whereas a collection-scoped where() gets Firestore's
// automatic single-field index for free. Merges are a rare admin action, not a
// hot path, so the extra round trips per product are the right trade.
async function brandedImageDocs(customerId) {
  const productsSnap = await getDocs(collection(db, 'products'))
  const perProduct = await Promise.all(
    productsSnap.docs.map(p =>
      getDocs(query(collection(db, 'products', p.id, 'images'), where('branded_for_customer_id', '==', customerId)))
    )
  )
  return perProduct.flatMap(s => s.docs)
}

// Copy every doc of a customer subcollection onto another customer, under the
// SAME doc ids (safe — Firestore auto-ids are effectively collision-free
// across parents), then delete the originals. Shared by Brand Gallery assets
// and the CRM Interaction Log — both are customers/{id}/{sub} subcollections
// that a plain deleteDoc(customers/{id}) would otherwise silently orphan.
async function copySubcollection(subcollection, fromCustomerId, toCustomerId) {
  const snap = await getDocs(collection(db, 'customers', fromCustomerId, subcollection))
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db)
    for (const d of snap.docs.slice(i, i + 400)) {
      batch.set(doc(db, 'customers', toCustomerId, subcollection, d.id), d.data())
      batch.delete(d.ref)
    }
    await batch.commit()
  }
  return snap.size
}

// Read-only — never writes. Lets the UI show what a merge would do before
// anyone commits to it: how many orders/quotes/portal-accounts move, and which
// fields the survivor would gain.
export async function previewCustomerMerge(duplicateId, survivorId) {
  if (duplicateId === survivorId) throw new Error('Cannot merge a customer into itself.')
  const [dupSnap, survSnap] = await Promise.all([
    getDoc(doc(db, 'customers', duplicateId)),
    getDoc(doc(db, 'customers', survivorId)),
  ])
  if (!dupSnap.exists() || !survSnap.exists()) throw new Error('Customer not found.')
  const duplicate = { id: duplicateId, ...normalizeCustomer(dupSnap.data()) }
  const survivor  = { id: survivorId, ...normalizeCustomer(survSnap.data()) }
  const { ordersSnap, quotesSnap, usersSnap } = await relatedDocs(duplicateId)
  const [assetsSnap, interactionsSnap, emailThreadsSnap, brandedImages] = await Promise.all([
    getDocs(collection(db, 'customers', duplicateId, 'assets')),
    getDocs(collection(db, 'customers', duplicateId, 'enquiries')),
    getDocs(collection(db, 'customers', duplicateId, 'email_threads')),
    brandedImageDocs(duplicateId),
  ])
  return {
    duplicate, survivor,
    fieldsToFill: fieldsToFillFrom(survivor, duplicate),
    ordersCount: ordersSnap.size,
    quotesCount: quotesSnap.size,
    accountsCount: usersSnap.size,
    assetsCount: assetsSnap.size,
    interactionsCount: interactionsSnap.size,
    emailThreadsCount: emailThreadsSnap.size,
    brandedImagesCount: brandedImages.length,
  }
}

// Execute the merge: repoint every order/quote/portal-account from the
// duplicate onto the survivor, fill the survivor's blank fields from the
// duplicate, then delete the duplicate. Chunked batches (Firestore's 500-write
// limit) — in practice one customer's related docs are far fewer than that.
//
// Beyond the original three collections, three more things get carried
// across — the duplicate's Firestore doc gets deleted at the end, and none of
// these survives that on its own:
//   - Brand Gallery assets (customers/{id}/assets, V7.21), the CRM
//     Interaction Log (customers/{id}/enquiries — found missing 2026-08-05,
//     same bug shape), and email_threads (V8.1) — all SUBcollections, so
//     deleting the parent customer doc does NOT delete them; each would be
//     silently orphaned (unreachable — nothing ever queries a dangling
//     customer id again) rather than actually removed. All copied via
//     copySubcollection() above. Any Storage files they reference are NOT
//     moved — the copied docs' URLs/paths still point at the originals,
//     which is fine; moving metadata doesn't require moving the blob.
//     email_summary itself (a generated field, not a subcollection) is
//     deliberately NOT carried across — it's a stale draft either way once
//     the survivor's thread set changes; hit Refresh after merging instead
//     of trusting a merged-but-not-regenerated summary.
//   - branded_for_customer_id tags on product images (see
//     firestore.rules viewerIsSensitive()) — repointed to the survivor so a
//     photo already tagged for the duplicate doesn't silently stop matching
//     anyone (which would either wrongly hide it from the survivor if later
//     marked sensitive, or just leave a tag nothing can ever resolve again).
export async function mergeCustomers(duplicateId, survivorId) {
  const preview = await previewCustomerMerge(duplicateId, survivorId)
  const { ordersSnap, quotesSnap, usersSnap } = await relatedDocs(duplicateId)
  const brandedImages = await brandedImageDocs(duplicateId)

  await copySubcollection('assets', duplicateId, survivorId)
  await copySubcollection('enquiries', duplicateId, survivorId)
  await copySubcollection('email_threads', duplicateId, survivorId)

  const allRefs = [...ordersSnap.docs, ...quotesSnap.docs, ...usersSnap.docs].map(d => d.ref)
  const brandedRefs = brandedImages.map(d => d.ref)
  const hasFields = Object.keys(preview.fieldsToFill).length > 0
  const CHUNK = 400

  // Fill the survivor's blank fields once, up front — independent of which
  // (if any) of the two repoint loops below actually runs.
  if (hasFields) {
    await updateDoc(doc(db, 'customers', survivorId), { ...preview.fieldsToFill, updatedAt: serverTimestamp() })
  }
  // customer_id on orders/quotes/users.
  for (let i = 0; i < allRefs.length; i += CHUNK) {
    const batch = writeBatch(db)
    allRefs.slice(i, i + CHUNK).forEach(ref => batch.update(ref, { customer_id: survivorId }))
    await batch.commit()
  }
  // branded_for_customer_id on product images — same repoint, different field
  // name and collection, so its own loop rather than forcing one field name
  // across both.
  for (let i = 0; i < brandedRefs.length; i += CHUNK) {
    const batch = writeBatch(db)
    brandedRefs.slice(i, i + CHUNK).forEach(ref => batch.update(ref, { branded_for_customer_id: survivorId }))
    await batch.commit()
  }

  await deleteDoc(doc(db, 'customers', duplicateId))
  return preview
}

// Live customer list (same client-side sort, same no-orderBy safety).
export function useCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(
    COL(),
    snap => {
      setCustomers(snap.docs.map(fromDoc).sort((a, b) => a.company_name.localeCompare(b.company_name)))
      setLoading(false)
    },
    () => setLoading(false),
  ), [])
  return { customers, loading }
}

// Display helper — canonical name with a safe fallback.
export const customerName = c => str(c?.company_name || c?.name) || '—'

// Import ERP customer records (JES `erp_customer` rows, via ERP Lookup) as real
// app Customers. Dedupes on erp_code against every existing customer — an ERP
// code that's already linked is skipped, not re-created, so re-importing (or
// selecting a row already brought in) is safe to repeat.
export async function importErpCustomers(erpRows) {
  const existing = await loadCustomers()
  const seen = new Set(existing.map(c => str(c.erp_code).toUpperCase()).filter(Boolean))
  const created = [], skipped = []
  for (const r of erpRows) {
    const code = str(r.code)
    const codeKey = code.toUpperCase()
    if (codeKey && seen.has(codeKey)) { skipped.push(code); continue }
    const companyName = str(r.name) || str(r.short_name) || code
    const res = await saveCustomer(null, {
      company_name: companyName,
      contact_name: str(r.contact),
      contact_emails: [r.email, r.email2].map(str).filter(Boolean),
      contact_phones: [r.phone, r.phone2, r.mobile].map(str).filter(Boolean),
      website: str(r.website),
      address: str(r.address),
      country: str(r.country),
      erp_code: code,
      // Old JES customers, not marketing leads — Active/Dormant reflects the
      // ERP's own expired flag rather than defaulting everyone to Prospect.
      crm_status: r.active === false ? 'Dormant' : 'Active',
      tags: ['erp-import'],
      notes: ['Imported from JES ERP (code ' + code + ').', str(r.remarks)].filter(Boolean).join(' '),
    })
    if (!res.ok) throw new Error(`Could not create a customer for ${code}: ${res.result.errors?.[0]?.message || 'validation failed'}`)
    created.push({ erpCode: code, customerId: res.id, companyName })
    if (codeKey) seen.add(codeKey)
  }
  return { created, skipped }
}

// ── Tag management (TagManager.jsx) ─────────────────────────────────────────
// Tags are a flat, entirely free-typed array on each customer — there is no
// picklist anymore (removed 2026-08-12: the owner found the old fixed
// Industry/Client Type/Order Profile/Geography groups hard to use and
// Geography redundant with the Country field). CustomerForm.jsx now offers
// autocomplete from whatever tags are already in use (loadAllTagNames)
// instead, Mailchimp-style — type to find an existing one, or add a new one.

// Every tag in use, with how many customers carry it and which ones. Reads
// the live customer list (not a snapshot) so counts are always current when
// TagManager opens.
export async function loadTagStats() {
  const customers = await loadCustomers()
  const byTag = new Map()
  for (const c of customers) {
    for (const tag of c.tags || []) {
      if (!byTag.has(tag)) byTag.set(tag, [])
      byTag.get(tag).push({ id: c.id, company_name: c.company_name })
    }
  }
  return [...byTag.entries()]
    .map(([tag, customers]) => ({ tag, count: customers.length, customers }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// Tag names only, most-used first — CustomerForm.jsx's autocomplete. Cheap
// version of loadTagStats() (no per-tag customer list) for a call that fires
// on every form load.
export async function loadAllTagNames() {
  const customers = await loadCustomers()
  const counts = new Map()
  for (const c of customers) {
    for (const tag of c.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
}

// Rewrite one tag to another across every customer that has it — used for
// both a rename (oldTag -> newTag) and a merge (several old tags -> one
// canonical tag, called once per old tag). If a customer already has the
// target tag, the old one is just dropped rather than creating a duplicate.
// No-op (but still resolves) for a customer that doesn't have oldTag.
export async function renameTagEverywhere(oldTag, newTag) {
  if (!oldTag || !newTag || oldTag === newTag) return 0
  const customers = await loadCustomers()
  const affected = customers.filter(c => c.tags?.includes(oldTag))
  for (let i = 0; i < affected.length; i += 400) {
    const batch = writeBatch(db)
    affected.slice(i, i + 400).forEach(c => {
      const next = unionArrays(c.tags.filter(t => t !== oldTag), [newTag])
      batch.update(doc(db, 'customers', c.id), { tags: next, updatedAt: serverTimestamp() })
    })
    await batch.commit()
  }
  return affected.length
}

// Remove one tag from every customer that has it.
export async function deleteTagEverywhere(tag) {
  if (!tag) return 0
  const customers = await loadCustomers()
  const affected = customers.filter(c => c.tags?.includes(tag))
  for (let i = 0; i < affected.length; i += 400) {
    const batch = writeBatch(db)
    affected.slice(i, i + 400).forEach(c => {
      batch.update(doc(db, 'customers', c.id), { tags: c.tags.filter(t => t !== tag), updatedAt: serverTimestamp() })
    })
    await batch.commit()
  }
  return affected.length
}

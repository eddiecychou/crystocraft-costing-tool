import { useState, useEffect } from 'react'
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  onSnapshot, serverTimestamp,
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
export const CHANNELS       = ['Email', 'WhatsApp Business', 'Alibaba', 'Personal WhatsApp']
export const CUSTOMER_SOURCES = ['Alibaba', 'Website', 'Email Marketing', 'Referral', 'Trade Show', 'BNI', 'Direct']

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
  'Latvia', 'Lebanon', 'Lithuania', 'Luxembourg',
  'Macau', 'Malaysia', 'Maldives', 'Mauritius', 'Mexico', 'Moldova', 'Mongolia', 'Morocco', 'Myanmar',
  'Netherlands', 'New Zealand', 'Nigeria', 'Norway',
  'Oman',
  'Pakistan', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar',
  'Romania', 'Russia',
  'Saudi Arabia', 'Serbia', 'Singapore', 'Slovakia', 'Slovenia', 'South Africa', 'South Korea',
  'Spain', 'Sri Lanka', 'Sweden', 'Switzerland',
  'Taiwan', 'Thailand', 'Turkey',
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

// Raw Firestore doc (or form state) → canonical customer object. READ shape:
// returns only canonical fields, with every legacy alias folded in. Never emits
// legacy keys (`name`, `region`, `primary_channel`).
export function normalizeCustomer(raw) {
  const r = raw || {}
  const emails    = arrFrom(r.contact_emails,    r.contact_email)
  const phones    = arrFrom(r.contact_phones,    r.contact_phone)
  const whatsapps = arrFrom(r.contact_whatsapps, r.whatsapp)
  return {
    company_name:      str(r.company_name || r.name),     // fold legacy `name`
    contact_name:      str(r.contact_name),
    contact_emails:    emails,
    contact_phones:    phones,
    contact_whatsapps: whatsapps,
    contact_wechats:   cleanArray(r.contact_wechats),
    website:           str(r.website),
    address:           str(r.address),
    country:           str(r.country || r.region),        // fold legacy `region`
    crm_category:      str(r.crm_category),
    crm_status:        str(r.crm_status),
    channels:          channelsOf(r),
    source:            str(r.source),
    segment:           str(r.segment),
    erp_code:          str(r.erp_code),
    tags:              cleanArray(r.tags),
    is_vip:            !!r.is_vip,
    is_personal_wa:    !!r.is_personal_wa,
    notes:             str(r.notes),
    folder_path:       str(r.folder_path),
    last_contacted:    r.last_contacted ?? null,
    createdAt:         r.createdAt ?? null,
    updatedAt:         r.updatedAt ?? null,
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
  const emails    = arrFrom(i.contact_emails,    i.contact_email)
  const phones    = arrFrom(i.contact_phones,    i.contact_phone)
  const whatsapps = arrFrom(i.contact_whatsapps, i.whatsapp)
  const channels  = channelsOf(i)
  return {
    company_name:  str(i.company_name || i.name),
    contact_name:  str(i.contact_name),
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
    contact_emails:    emails,
    contact_phones:    phones,
    contact_whatsapps: whatsapps,
    contact_wechats:   cleanArray(i.contact_wechats),
    contact_email: emails[0] || '',               // denormalized mirror (compat)
    contact_phone: phones[0] || '',               // denormalized mirror (compat)
    whatsapp:      whatsapps[0] || '',            // denormalized mirror (compat)
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
    await updateDoc(doc(db, 'customers', id), payload)
  } else {
    const ref = await addDoc(COL(), { ...payload, createdAt: serverTimestamp() })
    savedId = ref.id
  }
  return { ok: true, id: savedId, result: v }
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

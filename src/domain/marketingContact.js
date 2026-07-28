import { useState, useEffect, useCallback } from 'react'
import { collection, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

// Marketing contacts — the cleaned Mailchimp list, kept DELIBERATELY SEPARATE
// from the `customers` collection. Some people are in both; they are not merged.
// The only link back is `possible_customer_match`, a pointer set at import time.
//
// Read-mostly: loaded once (2.4k docs) rather than a live snapshot, with local
// optimistic updates on the few editable fields (review_status, app_notes).
// The imported Mailchimp fields are never edited from the app — only the
// app-side organising fields are.

const COL = () => collection(db, 'marketing_contacts')

export const MC_STATUSES = ['subscribed', 'nonsubscribed', 'unsubscribed', 'cleaned']
export const MC_AUDIENCES = ['trade', 'retail']
export const MC_RELATIONSHIPS = [
  'distributor', 'large retailer', 'retailer', 'oem', 'corp gift',
  'wholesaler', 'trophy', 'jewelry', 'glassware', 'home decor', 'wedding', 'licensing',
]
export const MC_REVIEW = [
  { value: '',          label: 'Unreviewed' },
  { value: 'keep',      label: 'Keep' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'drop',      label: 'Drop' },
]

const str = v => (v == null ? '' : String(v))
const arr = v => (Array.isArray(v) ? v.filter(Boolean) : [])

// Raw Firestore doc → canonical marketing-contact object.
export function normalizeContact(id, raw) {
  const r = raw || {}
  return {
    id,
    email:         str(r.email),
    first_name:    str(r.first_name),
    last_name:     str(r.last_name),
    company:       str(r.company),
    country:       str(r.country),
    domain:        str(r.domain),
    phone:         str(r.phone),
    website:       str(r.website),
    address:       str(r.address),
    tags:          arr(r.tags),
    audiences:     arr(r.audiences),
    status:        str(r.status) || 'subscribed',
    emailable:     !!r.emailable,
    is_customer:   !!r.is_customer,
    relationship:  str(r.relationship),
    channels:      arr(r.channels),
    freemail:      !!r.freemail,
    role_address:  !!r.role_address,
    member_rating: str(r.member_rating),
    optin_time:    str(r.optin_time),
    last_changed:  str(r.last_changed),
    possible_customer_match: r.possible_customer_match || null,
    mailchimp_notes:    str(r.mailchimp_notes),
    mailchimp_category: str(r.mailchimp_category),
    // App-side organising fields (editable).
    review_status: str(r.review_status),
    app_notes:     str(r.app_notes),
  }
}

const displayName = c =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company || c.email

export const contactName = displayName

// Load once, sorted by name. No orderBy on the query (avoids a composite-index
// requirement and a partial-cache miss) — sorted client-side like useCustomers.
export function useMarketingContacts() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDocs(COL())
      const rows = snap.docs.map(d => normalizeContact(d.id, d.data()))
      rows.sort((a, b) => displayName(a).localeCompare(displayName(b)))
      setContacts(rows)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])
  return { contacts, loading, reload, setContacts }
}

// Update only the app-side organising fields. The imported Mailchimp data is
// never written from the app.
export async function updateContactReview(id, patch) {
  const allowed = {}
  if ('review_status' in patch) allowed.review_status = str(patch.review_status)
  if ('app_notes' in patch)     allowed.app_notes = str(patch.app_notes)
  await updateDoc(doc(db, 'marketing_contacts', id), { ...allowed, updatedAt: serverTimestamp() })
}

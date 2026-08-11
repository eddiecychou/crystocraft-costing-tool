import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, getDoc, doc, updateDoc, setDoc, deleteDoc,
  writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { saveCustomer } from './customer'

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
export const MC_AUDIENCES = ['trade', 'retail', 'website']
// "Category" tags — the buyer-type tags promoted for filtering + highlighting.
// These used to be a separate `relationship` field, but that was derived from
// tags (every value already appeared as a tag), so it was merged back into tags.
export const MC_CATEGORIES = [
  'distributor', 'large retailer', 'retailer', 'oem', 'corp gift',
  'wholesaler', 'trophy', 'jewelry', 'glassware', 'home decor', 'wedding', 'licensing',
]
const CATEGORY_SET = new Set(MC_CATEGORIES)
export const isCategoryTag = t => CATEGORY_SET.has(t)
// Category tags first (so they survive a truncated display), then the rest.
export const sortTags = tags => [...tags].sort((a, b) => (isCategoryTag(b) ? 1 : 0) - (isCategoryTag(a) ? 1 : 0))

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
    // Daily Drafts outreach engine (V7.23) — mirrors customer.js's
    // lastOutreachAt; set only on an actual send, via markContactOutreach()
    // below, never through saveContact (that's the admin-edit-form path).
    lastOutreachAt: r.lastOutreachAt ?? null,
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Doc id from an email — same rule as the import + /api/subscribe endpoint, so a
// contact always resolves to one deterministic doc.
export const idFromEmail = email => String(email || '').trim().toLowerCase().replace(/\s+/g, '')

// Full edit of a contact. `emailable` is derived from status so the two can never
// disagree (subscribed = emailable, anything else = suppressed). Editing the email
// changes the doc id, so that case is a rename: write the new doc, delete the old,
// refusing if the target email already belongs to another contact.
export async function saveContact(currentId, data) {
  const email = str(data.email).trim().toLowerCase()
  if (!EMAIL_RE.test(email)) throw new Error('A valid email is required.')
  const status = MC_STATUSES.includes(data.status) ? data.status : 'subscribed'
  const patch = {
    first_name:   str(data.first_name),
    last_name:    str(data.last_name),
    email,
    company:      str(data.company),
    country:      str(data.country),
    phone:        str(data.phone),
    tags:         arr(data.tags),
    // A website signup can genuinely be either trade or retail (or both) —
    // it defaults to ['website'] at import/signup time but that's a source,
    // not a classification, so this needs to be editable per contact.
    audiences:    arr(data.audiences),
    status,
    emailable:    status === 'subscribed',
    is_customer:  !!data.is_customer,
    // review_status deliberately not written here — the review UI was
    // dropped from the Contacts page (not useful in practice); the field
    // itself is left untouched rather than reset, since updateDoc only
    // patches given keys and the rename branch below spreads `base` first.
    app_notes:    str(data.app_notes),
    updatedAt:    serverTimestamp(),
  }
  const newId = idFromEmail(email)
  if (newId === currentId) {
    await updateDoc(doc(db, 'marketing_contacts', currentId), patch)
    return newId
  }
  const target = await getDoc(doc(db, 'marketing_contacts', newId))
  if (target.exists()) throw new Error('Another contact already uses that email.')
  const cur = await getDoc(doc(db, 'marketing_contacts', currentId))
  const base = cur.exists() ? cur.data() : {}
  await setDoc(doc(db, 'marketing_contacts', newId), { ...base, ...patch })
  await deleteDoc(doc(db, 'marketing_contacts', currentId))
  return newId
}

// Daily Drafts outreach engine (V7.23) — stamps the cooldown timestamp on an
// actual send. Deliberately a direct updateDoc, not routed through
// saveContact (that's the admin-edit-form path with its own rename/validation
// semantics) — same split customer.js already has for lastOutreachAt.
export async function markContactOutreach(id) {
  await updateDoc(doc(db, 'marketing_contacts', id), { lastOutreachAt: serverTimestamp() })
}

export async function deleteContact(id) {
  await deleteDoc(doc(db, 'marketing_contacts', id))
}

// Bulk delete, chunked to Firestore's 500-write batch limit.
export async function deleteContacts(ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db)
    ids.slice(i, i + 400).forEach(id => batch.delete(doc(db, 'marketing_contacts', id)))
    await batch.commit()
  }
}

// Distinct tags with a contact count each, most-used first. The Mailchimp
// import left the tag set genuinely chaotic (one-off variants, near-dupes) —
// this is what both the filter dropdown and the tag manager below use, so
// they always show the REAL tags rather than the fixed MC_CATEGORIES subset
// (which is only the "promoted for filtering" handful).
export function tagCounts(contacts) {
  const m = new Map()
  for (const c of contacts) for (const t of c.tags) m.set(t, (m.get(t) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// Rename a tag across every contact that carries it. Renaming to a tag that
// already exists on some of those contacts MERGES rather than duplicates
// (tags are deduped per contact) — that's the main tool for cleaning up
// near-duplicate tags. Returns the number of contacts touched, chunked to
// Firestore's 500-write batch limit like deleteContacts above.
export async function renameTagEverywhere(contacts, from, to) {
  const target = str(to).trim().toLowerCase()
  if (!target) throw new Error('New tag name is required.')
  const affected = contacts.filter(c => c.tags.includes(from))
  for (let i = 0; i < affected.length; i += 400) {
    const batch = writeBatch(db)
    affected.slice(i, i + 400).forEach(c => {
      const tags = [...new Set(c.tags.map(t => (t === from ? target : t)))]
      batch.update(doc(db, 'marketing_contacts', c.id), { tags, updatedAt: serverTimestamp() })
    })
    await batch.commit()
  }
  return affected.length
}

// Remove a tag from every contact that carries it (the tag itself, not the
// contacts). Returns the number of contacts touched.
export async function deleteTagEverywhere(contacts, tag) {
  const affected = contacts.filter(c => c.tags.includes(tag))
  for (let i = 0; i < affected.length; i += 400) {
    const batch = writeBatch(db)
    affected.slice(i, i + 400).forEach(c => {
      const tags = c.tags.filter(t => t !== tag)
      batch.update(doc(db, 'marketing_contacts', c.id), { tags, updatedAt: serverTimestamp() })
    })
    await batch.commit()
  }
  return affected.length
}

// Record that a contact is now (or already was found to be) an app customer.
// A pointer, not a merge — the marketing contact stays a separate record; see
// the module header. is_customer flips to true because "linked to a real
// customer" is the strongest possible signal of that.
export async function linkContactToCustomer(id, customerId, companyName) {
  await updateDoc(doc(db, 'marketing_contacts', id), {
    possible_customer_match: { customer_id: customerId, company_name: str(companyName) },
    is_customer: true,
    updatedAt: serverTimestamp(),
  })
}

// Clear a manually- or import-set link — for when it was matched wrong, or
// the owner wants to unlink a contact from a customer without deleting
// either record. Deliberately does NOT touch is_customer: a contact can
// still be a genuine likely-customer without being pointed at a specific
// app record.
export async function unlinkContactFromCustomer(id) {
  await updateDoc(doc(db, 'marketing_contacts', id), {
    possible_customer_match: null,
    updatedAt: serverTimestamp(),
  })
}

// Promote selected marketing contacts into real app Customer records — the
// reverse direction from possible_customer_match, for a contact that turns out
// to be worth tracking as a customer. Contacts already linked are skipped (no
// second customer created for them); the caller decides how to report that.
// Returns { created: [{contactId, customerId, companyName}], skipped: [contactId] }.
export async function promoteContactsToCustomers(rows) {
  const created = [], skipped = []
  for (const c of rows) {
    if (c.possible_customer_match) { skipped.push(c.id); continue }
    const company = str(c.company) || displayName(c)
    const res = await saveCustomer(null, {
      company_name: company,
      contact_name: [c.first_name, c.last_name].filter(Boolean).join(' '),
      contact_emails: [c.email],
      contact_phones: c.phone ? [c.phone] : [],
      country: c.country,
      tags: c.tags,
      crm_status: 'Prospect',
      source: c.tags.includes('alibaba') ? 'Alibaba' : (c.audiences.includes('website') ? 'Website' : ''),
      notes: 'Added from Marketing Contacts (Mailchimp import).',
    })
    if (!res.ok) throw new Error(`Could not create a customer for ${c.email}: ${res.result.errors?.[0]?.message || 'validation failed'}`)
    await linkContactToCustomer(c.id, res.id, company)
    created.push({ contactId: c.id, customerId: res.id, companyName: company })
  }
  return { created, skipped }
}

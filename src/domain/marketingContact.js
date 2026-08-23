import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, getDoc, doc, addDoc, updateDoc, setDoc, deleteDoc,
  writeBatch, serverTimestamp, arrayUnion, runTransaction,
} from 'firebase/firestore'
import { db } from '../firebase'
import { saveCustomer, RETAIL_TAG } from './customer'
import { countryFromPhone } from './phoneCountry'
import { repointDraftsToCustomer } from './outreachDrafts'

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
    // lastOutreachAt/blockOutreachUntil; set only via markContactOutreach()/
    // blockContactOutreach() below, never through saveContact (that's the
    // admin-edit-form path).
    lastOutreachAt: r.lastOutreachAt ?? null,
    blockOutreachUntil: r.blockOutreachUntil ?? null,
    // Draft Memory Layer (V8.9) — a short, admin-edited relationship summary
    // ("prefers WhatsApp over email", "distributor, price-sensitive, replies
    // slowly") fed into the Daily Drafts prompts alongside the global rules.
    // Free text like app_notes, but capped and specifically about how to
    // WRITE to this person — see updateContactAiSummary() below and
    // netlify/edge-functions/lib/draftMemory.js.
    ai_context_summary: str(r.ai_context_summary),
    ai_context_updated_at: r.ai_context_updated_at ?? null,
    // WhatsApp summary (V8.9 — extended from customers/, see
    // whatsappSummaryApi.js's generateAndSaveWhatsappSummary). Generated
    // on-demand from marketing_contacts/{id}/whatsapp_threads, same shape
    // as the customer version: { summary, recent_activity,
    // open_commitments[], thread_count, message_count, generated_at }.
    whatsapp_summary: r.whatsapp_summary || null,
  }
}

export const AI_CONTEXT_SUMMARY_MAX_WORDS = 120

// Direct write, no review step — unlike global rules (which steer every
// draft and need approval), this only affects drafts to ONE contact, same
// blast radius as editing app_notes.
export async function updateContactAiSummary(contactId, summary, updatedBy) {
  const clean = String(summary || '').trim()
  const wc = clean.split(/\s+/).filter(Boolean).length
  if (wc > AI_CONTEXT_SUMMARY_MAX_WORDS) {
    throw new Error(`Keep the contact summary to ${AI_CONTEXT_SUMMARY_MAX_WORDS} words or fewer — this is ${wc}.`)
  }
  await updateDoc(doc(db, 'marketing_contacts', contactId), {
    ai_context_summary: clean,
    ai_context_updated_at: serverTimestamp(),
    ai_context_updated_by: updatedBy || null,
  })
}

const displayName = c =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company || c.email || c.phone

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

// Doc id from a phone number — for WhatsApp leads that never gave a name or
// email (V8.2, owner 2026-08-12: numbers that message the shop but never
// convert to a real order, "weak leads", mostly retail — deliberately NOT
// filed under customers/). "wa-" prefixed so it can never collide with an
// idFromEmail-keyed doc even if the digits happened to match something.
export const idFromPhone = phone => 'wa-' + String(phone || '').replace(/[^\d]/g, '')

// Find or create a marketing contact keyed by phone alone — the WhatsApp
// import page's "Save as Lead" path (whatsappImport.js), for a chat that
// isn't a real customer relationship. Deliberately bypasses saveContact()
// above (which requires a valid email) — a phone-only lead has neither a
// name nor an email, only the number WhatsApp exported. Idempotent: calling
// this again for the same phone returns the existing doc rather than
// resetting it, so re-importing that lead's chat doesn't wipe out anything
// an admin already filled in by hand since the first import.
export async function findOrCreateLeadByPhone(phone) {
  const id = idFromPhone(phone)
  if (id === 'wa-') throw new Error('No usable phone number for this lead.')
  const ref = doc(db, 'marketing_contacts', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    // Country guessed from the number's own dialing code (owner, 2026-08-12
    // — "so I don't need to key in every time") — a starting default, not
    // authoritative; see phoneCountry.js's own caveats (e.g. +1 could be
    // Canada, not just the US). Blank rather than guessed wrong is the
    // fallback when the code isn't recognized.
    await setDoc(ref, {
      phone: str(phone),
      country: countryFromPhone(phone),
      status: 'subscribed',
      emailable: false,
      audiences: ['retail'],
      tags: ['whatsapp-lead'],
      is_customer: false,
      createdAt: serverTimestamp(),
    })
  }
  return id
}

// Full edit of a contact. `emailable` is derived from status so the two can never
// disagree (subscribed = emailable, anything else = suppressed). Editing the email
// changes the doc id, so that case is a rename: write the new doc, delete the old,
// refusing if the target email already belongs to another contact.
//
// Phone-only WhatsApp leads (findOrCreateLeadByPhone above — doc id is
// idFromPhone(phone), no email field at all) previously could NEVER pass
// this function's hard `EMAIL_RE.test(email)` requirement — Save always
// threw "A valid email is required." for one of these, silently (the error
// banner was easy to scroll past), which read as "Save does nothing" (owner
// report, 2026-08-23). Fixed by only requiring/validating an email when one
// is actually being set — a phone-only lead with a blank email field now
// saves in place (no rename attempt, since there's no email to derive a new
// id from), same as any other contact. At least one of email/phone must
// still be present; that's the one case with no way to identify the record.
export async function saveContact(currentId, data) {
  const email = str(data.email).trim().toLowerCase()
  const phone = str(data.phone)
  if (email && !EMAIL_RE.test(email)) throw new Error('That doesn\'t look like a valid email — leave it blank if this contact only has a phone number.')
  if (!email && !phone) throw new Error('An email or phone number is required.')
  const status = MC_STATUSES.includes(data.status) ? data.status : 'subscribed'
  const patch = {
    first_name:   str(data.first_name),
    last_name:    str(data.last_name),
    email,
    company:      str(data.company),
    country:      str(data.country),
    phone,
    tags:         arr(data.tags),
    // A website signup can genuinely be either trade or retail (or both) —
    // it defaults to ['website'] at import/signup time but that's a source,
    // not a classification, so this needs to be editable per contact.
    audiences:    arr(data.audiences),
    status,
    emailable:    status === 'subscribed' && !!email,
    is_customer:  !!data.is_customer,
    // review_status deliberately not written here — the review UI was
    // dropped from the Contacts page (not useful in practice); the field
    // itself is left untouched rather than reset, since updateDoc only
    // patches given keys and the rename branch below spreads `base` first.
    app_notes:    str(data.app_notes),
    updatedAt:    serverTimestamp(),
  }
  // No email (or unchanged email) — update in place, no rename. A blank
  // email can't derive a doc id at all, so this is the ONLY safe path for a
  // phone-only lead; idFromEmail('') would collide every phone-only contact
  // onto the same doc id.
  const newId = email ? idFromEmail(email) : currentId
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

// "Don't suggest this person for now" — the owner's own knowledge that
// they're already talking to this contact manually, which nothing in the
// app can otherwise detect (see DailyDrafts.jsx's "Don't suggest" action).
export async function blockContactOutreach(id, until) {
  await updateDoc(doc(db, 'marketing_contacts', id), { blockOutreachUntil: until })
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
// A pointer, not a merge — the marketing contact record itself stays put
// (never deleted, never mutated beyond the fields below); see the module
// header. is_customer flips to true because "linked to a real customer" is
// the strongest possible signal of that.
//
// SU-08 Phase 2 (2026-08-19) — supersedes the Phase 1 version, which MOVED
// (copied then deleted) the whatsapp_threads subcollection onto the
// customer. Live-data check before this change found that move had never
// actually executed against a real record (0 of 68 already-linked contacts
// have any whatsapp_threads left under marketing_contacts/, and all 68 were
// linked at Mailchimp import time, not via this function), so there was
// nothing to reconcile — this is a straight replacement, not a migration of
// already-moved data.
//
// Now uses REFERENCES instead of copying:
//   1. app_notes is copied into ONE Interaction Log entry at a DETERMINISTIC
//      doc id (idempotent — a retry can't create a second copy), but the
//      live field on marketing_contacts/{id} is left untouched and stays
//      reachable via linked_marketing_contact_ids below (so a note added to
//      the lead AFTER conversion is still visible, not just a frozen
//      snapshot from link-time).
//   2. whatsapp_threads is NEVER copied or deleted — it stays permanently at
//      marketing_contacts/{id}/whatsapp_threads (also where any FUTURE
//      re-import for this same lead will keep landing, avoiding the
//      fragmentation a move would cause). customers/{customerId}.
//      linked_marketing_contact_ids (a new array field, arrayUnion — safe to
//      repeat) is the explicit cross-reference CustomerDetail.jsx reads to
//      merge those threads into its WhatsApp card, admin-only same as
//      everywhere else (no new Firestore rule needed).
//   3. outreach_drafts are repointed via repointDraftsToCustomer() —
//      unchanged from Phase 1, already idempotent.
//   4. marketing_contacts/{id}.linked_at is stamped once (first link only —
//      a retry doesn't overwrite the true original link time) as the
//      migration metadata this goal asked for.
// Every step is safe to repeat — see each step's own comment for why.
// Best-effort: a failure in the notes-migration step doesn't block the link
// itself (the pointer + cross-reference are what must not silently fail),
// but IS surfaced to the caller so it isn't silently lost either.
export async function linkContactToCustomer(id, customerId, companyName) {
  let historyWarning = ''
  try {
    // Deterministic id + transaction create-if-absent: a retry finds the
    // doc already there and no-ops, instead of addDoc's auto-id creating a
    // second copy every time this function is called again.
    const notesRef = doc(db, 'customers', customerId, 'enquiries', `migrated_notes_${id}`)
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(notesRef)
      if (existing.exists()) return
      const contactSnap = await tx.get(doc(db, 'marketing_contacts', id))
      const notes = contactSnap.exists() ? str(contactSnap.data().app_notes) : ''
      if (!notes) return
      tx.set(notesRef, {
        date: serverTimestamp(),
        contact_id: null,
        description: `Notes carried over from the Marketing Contact record at the time this lead was linked to this customer:\n\n${notes}`,
        product_interest: [],
        channel: '',
        status: 'Open',
        follow_up_date: null,
        outcome_notes: '',
        linked_quote_ids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })

    await repointDraftsToCustomer(id, customerId)
  } catch (e) {
    // Never let this block the link itself — the pointer/cross-reference
    // below are what absolutely must land.
    historyWarning = e?.message || 'Could not fully migrate this lead\'s notes history.'
  }

  await updateDoc(doc(db, 'customers', customerId), {
    linked_marketing_contact_ids: arrayUnion(id),
  })

  // linked_at is stamped only once — checked first so a retry doesn't
  // overwrite the true original link time with "now".
  const contactSnap = await getDoc(doc(db, 'marketing_contacts', id))
  const alreadyLinkedAt = contactSnap.exists() && contactSnap.data().linked_at
  await updateDoc(doc(db, 'marketing_contacts', id), {
    possible_customer_match: { customer_id: customerId, company_name: str(companyName) },
    is_customer: true,
    ...(alreadyLinkedAt ? {} : { linked_at: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  })

  // Returned, not thrown — the link itself succeeded and existing callers
  // (promoteContactsToCustomers' for-loop, DailyDrafts.jsx's bulk/single
  // link actions) don't expect this call to fail; a throw here would abort
  // an otherwise-successful bulk promote partway through. Callers that want
  // to surface this can check the return value.
  return { historyWarning: historyWarning || null }
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
    // A contact whose audience includes "retail" or "website" came in through
    // the public online shop (www.crystocraft.com, WooCommerce) or is
    // otherwise a known retail/individual buyer — owner, 2026-08-12: those
    // are reliably retail, tagged here rather than left to be set by hand.
    const isRetail = c.audiences.includes('retail') || c.audiences.includes('website')
    const tags = isRetail && !c.tags.includes(RETAIL_TAG) ? [...c.tags, RETAIL_TAG] : c.tags
    const res = await saveCustomer(null, {
      company_name: company,
      contact_name: [c.first_name, c.last_name].filter(Boolean).join(' '),
      contact_emails: [c.email],
      contact_phones: c.phone ? [c.phone] : [],
      country: c.country,
      tags,
      crm_status: 'Prospect',
      source: c.tags.includes('alibaba') ? 'Alibaba' : (c.audiences.includes('website') ? 'Website' : ''),
      notes: 'Added from Marketing Contacts (Mailchimp import).',
    })
    if (!res.ok) throw new Error(`Could not create a customer for ${c.email}: ${res.result.errors?.[0]?.message || 'validation failed'}`)
    const { historyWarning } = await linkContactToCustomer(c.id, res.id, company)
    created.push({ contactId: c.id, customerId: res.id, companyName: company, historyWarning })
  }
  return { created, skipped }
}

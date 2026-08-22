import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, orderBy, query, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

// Marketing campaigns — "one campaign at a time" scope: pick a segment out of
// marketing_contacts, write one message, send it out in batches (the app has
// no cron; a human clicks "Send next batch" — see Campaigns.jsx). Each
// campaign doc tracks its own sent/failed maps so a multi-day send resumes
// correctly and never re-sends someone.
const COL = () => collection(db, 'marketing_campaigns')

export async function listCampaigns() {
  const snap = await getDocs(query(COL(), orderBy('created_at', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// bodyHtml is the Unlayer-exported HTML (see Campaigns.jsx); design is its
// JSON source, kept so a campaign could be reopened for editing later even
// though that's not part of "one campaign at a time" scope yet.
//
// Firestore's addDoc() rejects ANY `undefined` value anywhere in a nested
// object, and Unlayer's exported design is a large, deeply nested object with
// some optional fields genuinely undefined in JS — a JSON round-trip strips
// those the same way JSON.stringify always has, and is cheap next to the
// design blob's own size.
const stripUndefined = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

export async function createCampaign({ name, subject, bodyHtml, design, segment }) {
  const ref = await addDoc(COL(), {
    name, subject, bodyHtml, design: stripUndefined(design), segment,
    status: 'active',
    sent: {}, failed: {},
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })
  return ref.id
}

// Record a batch's outcomes. Firestore supports dot-path field updates within
// a single doc (no 500-write-batch limit — that's for writes across docs), so
// up to a full batch's worth of sent/failed entries land in one call.
export async function recordBatchResults(campaignId, results) {
  const patch = { updated_at: serverTimestamp() }
  const nowIso = new Date().toISOString()
  for (const r of results) {
    if (r.ok) patch[`sent.${r.id}`] = nowIso
    else patch[`failed.${r.id}`] = String(r.error || 'failed').slice(0, 300)
  }
  await updateDoc(doc(db, 'marketing_campaigns', campaignId), patch)
}

export async function setCampaignStatus(campaignId, status) {
  await updateDoc(doc(db, 'marketing_campaigns', campaignId), { status, updated_at: serverTimestamp() })
}

// Segment filter over the already-loaded marketing_contacts list (2.4k docs,
// loaded once — see useMarketingContacts).
// { tag } | { audience } | { all: true } | { ids: [...] } — the last is a
// hand-picked list (owner, 2026-08-06: "click a few contacts and send a
// template email"), set from the Contacts tab's row checkboxes rather than a
// tag/audience filter.
export function matchesSegment(contact, segment) {
  if (!segment) return false
  if (segment.all) return true
  if (segment.tag) return contact.tags.includes(segment.tag)
  if (segment.audience) return contact.audiences.includes(segment.audience)
  if (segment.ids) return segment.ids.includes(contact.id)
  return false
}

// Contacts eligible for the NEXT batch of a campaign: matches the segment,
// currently emailable, and not already sent-to or failed-on for this campaign.
// (A failed send is left out of retries by default — most failures are a bad
// address, not a transient one; re-adding retry is a small follow-up if it
// turns out otherwise.)
export function eligibleContacts(campaign, allContacts, batchSize = 80) {
  const sent = campaign.sent || {}
  const failed = campaign.failed || {}
  const pool = allContacts.filter(c =>
    c.status === 'subscribed' && c.emailable &&
    matchesSegment(c, campaign.segment) &&
    !sent[c.id] && !failed[c.id]
  )
  return { batch: pool.slice(0, batchSize), remaining: pool.length }
}

// Retail Customer campaigns (2026-08-22) — a SEPARATE audience source from
// marketing_contacts, since the owner: "campaigns will be more targeting B2C
// retail because i personally don't know the customers unlike the b2b."
// A campaign targets ONE source or the other, never both — segment.source
// discriminates (`undefined`/'contacts' = the existing marketing_contacts
// path above, untouched; 'customers' = this one). v1 has no sub-segmentation
// within retail customers (no tag/audience concept there yet) — the segment
// IS "every retail customer," full stop.
//
// customer_type === 'retail' is the hard boundary — a B2B customer must never
// be reachable through this path even if a segment object were mis-shaped to
// claim `all: true`. Eligibility mirrors eligibleContacts' shape (matched
// batch + remaining count) but the suppression fields are different:
// customers have no status/emailable (that's a marketing_contacts-only
// concept — see customer.js) — `unsubscribed` is the new, real one-click
// suppression flag (wired through /api/unsubscribe with a `col=customers`
// discriminator, see send-campaign.js), and email_bounced/email_complained
// already existed for the bounce-tracking banner on CustomerDetail.jsx.
export function eligibleRetailCustomers(campaign, allCustomers, batchSize = 80) {
  const sent = campaign.sent || {}
  const failed = campaign.failed || {}
  const pool = allCustomers.filter(c =>
    c.customer_type === 'retail' &&
    !c.unsubscribed && !c.email_bounced && !c.email_complained &&
    (c.contact_emails || [])[0] &&
    !sent[c.id] && !failed[c.id]
  )
  return { batch: pool.slice(0, batchSize), remaining: pool.length }
}

// Reusable starting points for a new campaign, owner-authored from the
// editor (not the hardcoded TEMPLATES in Campaigns.jsx, which are this
// app's own built-in starters) — "where do I add a template?" (owner,
// 2026-08-07). Separate collection, not campaigns themselves: a template has
// no segment/send-state, and browsing past sent campaigns to find "the one
// with the good layout" isn't what a template picker is for.
const TEMPLATE_COL = () => collection(db, 'campaign_templates')

export async function listTemplates() {
  const snap = await getDocs(query(TEMPLATE_COL(), orderBy('created_at', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function saveTemplate({ name, subject, design }) {
  const ref = await addDoc(TEMPLATE_COL(), {
    name, subject, design: stripUndefined(design),
    created_at: serverTimestamp(),
  })
  return ref.id
}

// Overwrite an existing template in place — "I can't even edit and save the
// existing template" (owner, 2026-08-07). Name is deliberately NOT updated
// here (rename is a separate, rarer action than "I tweaked the copy, save
// it back") — callers that want a rename can pass it, but the common path
// (Campaigns.jsx's "Update this template") only ever changes subject/design.
export async function updateTemplate(id, { name, subject, design }) {
  const patch = { subject, design: stripUndefined(design), updated_at: serverTimestamp() }
  if (name != null) patch.name = name
  await updateDoc(doc(db, 'campaign_templates', id), patch)
}

export async function deleteTemplate(id) {
  await deleteDoc(doc(db, 'campaign_templates', id))
}

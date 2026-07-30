import {
  collection, doc, addDoc, updateDoc, getDocs, orderBy, query, serverTimestamp,
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
export async function createCampaign({ name, subject, bodyHtml, design, segment }) {
  const ref = await addDoc(COL(), {
    name, subject, bodyHtml, design, segment,
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
// loaded once — see useMarketingContacts). { tag } | { audience } | { all: true }.
export function matchesSegment(contact, segment) {
  if (!segment) return false
  if (segment.all) return true
  if (segment.tag) return contact.tags.includes(segment.tag)
  if (segment.audience) return contact.audiences.includes(segment.audience)
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

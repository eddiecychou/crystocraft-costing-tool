import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'

// Daily Drafts re-engagement engine (V7.23) — one doc per (customer, product)
// AI-drafted outreach email, reviewed by a human before it ever sends. Shaped
// like domain/campaigns.js: this module owns Firestore reads/writes; the AI
// generation and the actual send go through edge functions (src/outreachApi.js)
// since those need server-side secrets (DEEPSEEK_API_KEY, RESEND_API_KEY).
const COL = () => collection(db, 'outreach_drafts')

// Firestore's addDoc() rejects `undefined` anywhere in a nested object — same
// reason campaigns.js carries this helper; a customerContext string built
// from several optional sources can easily end up with stray undefineds.
const stripUndefined = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

// NOTE: no orderBy() here even though the caller wants fitScore-desc order —
// where('status','==',...) + orderBy('fitScore') are on different fields,
// which needs a composite index that doesn't exist (and creating one is a
// manual step in the Firebase console, not something a git push applies).
// Same reasoning as loadCustomers() in domain/customer.js: fetch unordered,
// sort client-side.
export async function listPendingDrafts() {
  const snap = await getDocs(query(COL(), where('status', '==', 'pending_review')))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
}

// Every draft ever created for a topic (any status), for the "Generate"
// flow's exclusion check (DailyDrafts.jsx). A customer already sitting in
// pending_review for this topic must be excluded outright — otherwise
// clicking Generate again (or a second run re-picking the same top-fit
// customers) creates duplicate drafts for the same person, which is exactly
// what happened before this function existed. A 'sent' draft is excluded
// only within the cooldown window (the caller applies that part). Every
// draft carries a topicLabel — for a product-linked compose it defaults to
// the product name (V7.23's `productId`-scoped exclusion generalizes into
// this rather than needing two separate code paths).
export async function listDraftsForTopic(topicLabel) {
  const snap = await getDocs(query(COL(), where('topicLabel', '==', topicLabel)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// One Firestore write per draft (not a batch) — drafts are created in the
// tens, not hundreds, and a partial failure here should surface per-item
// rather than fail the whole generate as one unit.
// `meta.productId`/`productName`/`productSource` are optional — present
// only when the Compose phase was linked to a specific product (for its
// photo gallery); a generic topic (news/update, portal invite, etc.) has
// none of them, just `topicLabel`. `imageUrls`/`links` are chosen once
// per generate run (same message == same photos/links make sense for every
// draft in the batch) and stored on each draft so review/send doesn't need
// to re-derive them — see DailyDrafts.jsx's image picker and link form.
export async function createDrafts(meta, drafts, { imageUrls, links } = {}) {
  const created = []
  for (const d of drafts) {
    const ref = await addDoc(COL(), stripUndefined({
      createdAt: serverTimestamp(),
      customerId: d.customerId,
      // Separate from customerId above (which stays whatever it was at SEND
      // time — the accurate historical record of who this specific draft
      // targeted) — personId is the CURRENT correlation key for this
      // person, repointed by repointDraftsToCustomer() below when a
      // contact-sourced draft's person later converts to a real customer.
      // Without this, a draft's engagement/reply history stayed permanently
      // attached to the old marketing_contacts id even after conversion —
      // found during the SU-08 interaction-log audit, 2026-08-18.
      personId: d.customerId,
      customerEmail: d.customerEmail,
      customerName: d.customerName,
      customerContext: d.customerContext || '',
      // 'customer' | 'contact' — which collection customerId points into,
      // so send-time knows whether to stamp lastOutreachAt on customers/ or
      // marketing_contacts/ (see DailyDrafts.jsx's handleSend).
      source: d.source || 'customer',
      topicLabel: meta.topicLabel,
      productId: meta.productId || null,
      productName: meta.productName || null,
      // 'corporate' | 'range' — which product catalogue this came from (see
      // productSource.js); needed at review time to fetch the RIGHT product's
      // images when adding a photo to this specific draft. Null when this
      // wasn't linked to a product at all.
      productSource: meta.productId ? (meta.productSource || 'corporate') : null,
      fitScore: d.fitScore ?? null,
      fitReason: d.fitReason || '',
      // Which context sources actually fed this draft (see
      // generate-outreach-drafts.js's contextSources()) — shown as a small
      // indicator on the review card so "was the email history actually
      // used?" has a real answer instead of the owner having to guess.
      contextSources: d.contextSources || [],
      draftSubject: d.draftSubject,
      draftBody: d.draftBody,
      imageUrls: imageUrls || [],
      links: links || [],
      status: 'pending_review',
    }))
    created.push(ref.id)
  }
  return created
}

export async function markDraftSent(draftId, reviewerUid) {
  await updateDoc(doc(db, 'outreach_drafts', draftId), {
    status: 'sent',
    sentAt: serverTimestamp(),
    reviewedAt: serverTimestamp(),
    reviewedBy: reviewerUid || '',
  })
}

export async function skipDraft(draftId, reviewerUid, skipReason) {
  await updateDoc(doc(db, 'outreach_drafts', draftId), {
    status: 'skipped',
    skipReason: skipReason || '',
    reviewedAt: serverTimestamp(),
    reviewedBy: reviewerUid || '',
  })
}

// Sent drafts, for the "Sent" section (engagement badges + Mark as replied —
// see DailyDrafts.jsx). No orderBy, same composite-index reasoning as above;
// sorted client-side by sentAt descending.
export async function listSentDrafts() {
  const snap = await getDocs(query(COL(), where('status', '==', 'sent')))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.sentAt?.toMillis?.() ?? 0) - (a.sentAt?.toMillis?.() ?? 0))
}

// channel/replyText are optional — the owner is often replied-to on
// WhatsApp/WeChat/Alibaba rather than email, which Resend's webhook can't
// see at all (it only knows about the outbound send). Stored on the draft
// as a quick record; the same reply also gets logged to the customer's CRM
// Interaction Log by the caller (DailyDrafts.jsx's handleLogReply) — this is
// just the Daily-Drafts-local copy.
export async function markDraftReplied(draftId, { channel, replyText } = {}) {
  await updateDoc(doc(db, 'outreach_drafts', draftId), {
    repliedAt: serverTimestamp(),
    repliedChannel: channel || '',
    replyText: replyText || '',
  })
}

// Recent sent/skipped decisions, for the "historicalHints" fed into the
// fit-score prompt (see generate-outreach-drafts.js) — a single-field 'in'
// filter needs no composite index (unlike the status+orderBy combo above),
// but still sorted client-side rather than trusting Firestore's default
// order, and capped to the most recent N once sorted.
export async function listRecentDecisions(limitCount = 60) {
  const snap = await getDocs(query(COL(), where('status', 'in', ['sent', 'skipped'])))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const at = a.reviewedAt?.toMillis?.() ?? 0
      const bt = b.reviewedAt?.toMillis?.() ?? 0
      return bt - at
    })
    .slice(0, limitCount)
}

// Called from domain/marketingContact.js's linkContactToCustomer() when a
// marketing_contacts lead converts to (or links to) a real customers/
// record — repoints every outreach_drafts doc's personId from the old
// contact id to the new customer id, so engagement/reply history follows
// the PERSON through conversion instead of staying stranded under an id
// that's now just a linked, no-longer-primary record. customerId/source on
// each draft are left untouched (accurate history of what that draft
// actually targeted at send time); only personId (the correlation key) moves.
// Only finds drafts created AFTER personId started being stamped (this
// change) — a draft from before then has no personId field at all and
// won't match this equality query. No retroactive backfill; acceptable
// since old drafts' engagement history was already this same kind of
// stranded before today.
export async function repointDraftsToCustomer(oldPersonId, newPersonId) {
  if (!oldPersonId || oldPersonId === newPersonId) return 0
  const snap = await getDocs(query(COL(), where('personId', '==', oldPersonId)))
  const refs = snap.docs.map(d => d.ref)
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db)
    refs.slice(i, i + 400).forEach(ref => batch.update(ref, { personId: newPersonId }))
    await batch.commit()
  }
  return refs.length
}

// Bulk cleanup — deletes every pending_review draft outright (not marked
// skipped: these are almost always testing/duplicate clutter, not real
// decisions worth an audit trail). Chunked at Firestore's 500-write batch
// limit, same idiom as domain/customer.js's deleteContacts.
export async function deleteAllPending() {
  const snap = await getDocs(query(COL(), where('status', '==', 'pending_review')))
  const refs = snap.docs.map(d => d.ref)
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db)
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref))
    await batch.commit()
  }
  return refs.length
}

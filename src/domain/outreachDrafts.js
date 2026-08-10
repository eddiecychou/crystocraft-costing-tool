import {
  collection, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp,
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

// Every draft ever created for a product (any status), for the "Generate
// Drafts" flow's exclusion check (DailyDrafts.jsx). A customer already
// sitting in pending_review for this product must be excluded outright —
// otherwise clicking Generate again (or a second run re-picking the same
// top-fit customers) creates duplicate drafts for the same person, which is
// exactly what happened before this function existed. A 'sent' draft is
// excluded only within the cooldown window (the caller applies that part).
export async function listDraftsForProduct(productId) {
  const snap = await getDocs(query(COL(), where('productId', '==', productId)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// One Firestore write per draft (not a batch) — drafts are created in the
// tens, not hundreds, and a partial failure here should surface per-item
// rather than fail the whole generate as one unit.
export async function createDrafts(product, drafts) {
  const created = []
  for (const d of drafts) {
    const ref = await addDoc(COL(), stripUndefined({
      createdAt: serverTimestamp(),
      customerId: d.customerId,
      customerEmail: d.customerEmail,
      customerName: d.customerName,
      customerContext: d.customerContext || '',
      productId: product.id,
      productName: product.name,
      fitScore: d.fitScore ?? null,
      fitReason: d.fitReason || '',
      draftSubject: d.draftSubject,
      draftBody: d.draftBody,
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

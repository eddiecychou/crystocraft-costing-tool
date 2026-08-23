import {
  collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

// CRM Interaction Log (V8.9) — a shared read/write path for the
// `enquiries` subcollection, previously only ever written inline against
// `customers/{id}/enquiries` (CustomerDetail.jsx/EnquiryForm.jsx, and
// DailyDrafts.jsx's own file-private logInteraction()) with no dedicated
// domain module anywhere. Pulled out here so `marketing_contacts` can get
// the exact same log — same doc shape, same collection name — rather than a
// second, divergent implementation. Deliberately a SUBSET of EnquiryForm's
// full schema: attachments/linked_quote_ids/status-pill workflow are
// quote-sales concepts that don't apply to a marketing lead; this only
// covers what both a quick manual "log a finding" action and an automatic
// system-logged entry actually need.
//
// Using the SAME subcollection name ('enquiries') as customers is
// deliberate, not incidental: DailyDrafts.jsx's checkAlreadyContacted() runs
// a collectionGroup('enquiries') query across every parent collection at
// once — reusing the name means marketing_contacts leads become visible to
// topic-deduplication for free, closing a real gap (previously: 124 of the
// last 135 sent Daily Drafts went to contacts, entirely invisible to that
// check). See firestore.rules' `{path=**}/enquiries` wildcard rule, which
// already matches any parent path and needed no change.
export async function addInteraction(collectionName, id, { description, channel, productInterest, date }) {
  const clean = String(description || '').trim()
  if (!clean) throw new Error('A description is required.')
  await addDoc(collection(db, collectionName, id, 'enquiries'), {
    date: date ? Timestamp.fromDate(new Date(date)) : Timestamp.now(),
    contact_id: null,
    description: clean,
    product_interest: productInterest ? [productInterest] : [],
    channel: channel || 'Email',
    status: 'Open',
    follow_up_date: null,
    outcome_notes: '',
    linked_quote_ids: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function listInteractions(collectionName, id) {
  const snap = await getDocs(query(collection(db, collectionName, id, 'enquiries'), orderBy('date', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function deleteInteraction(collectionName, id, interactionId) {
  await deleteDoc(doc(db, collectionName, id, 'enquiries', interactionId))
}

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

// Draft Memory Layer (V8.9) — global writing rules shared across every Daily
// Draft prompt. Deliberately NOT a chat log or vector store: a small,
// admin-curated list, capped hard, so it can be pasted straight into a
// prompt without materially moving API cost. See PROJECT-PLAN.md V8.9 for
// the design writeup and netlify/edge-functions/lib/draftMemory.js for how
// this gets folded into prompts server-side.
//
// Nothing here is written automatically. A rule is created only via the
// "Remember this rule" action in DailyDrafts.jsx (owner-confirmed) or a
// direct admin add — and even then starts 'pending', not 'active'. It only
// reaches prompts after a second, explicit approval step (the review list),
// per Eddie's requirement that a thing steering every future draft shouldn't
// go live off a single confirm.
const COL = () => collection(db, 'draft_memory_rules')

export const MAX_ACTIVE_RULES = 8
export const MAX_RULE_WORDS = 40 // a "rule" is one sentence, not a paragraph

const wordCount = s => String(s || '').trim().split(/\s+/).filter(Boolean).length
const normalize = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

export function ruleFromDoc(d) {
  const r = d.data ? d.data() : d
  return {
    text: String(r.text || ''),
    status: r.status || 'pending', // 'pending' | 'active' | 'disabled'
    source: r.source || 'confirmed', // 'confirmed' (from a draft chat) | 'admin' (typed directly)
    createdAt: r.createdAt || null,
    createdBy: r.createdBy || null,
    reviewedAt: r.reviewedAt || null,
    reviewedBy: r.reviewedBy || null,
  }
}

export async function listDraftMemoryRules() {
  const snap = await getDocs(COL())
  return snap.docs.map(d => ({ id: d.id, ...ruleFromDoc(d) }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
}

// Only the rules actually eligible to reach a prompt — capped defensively
// here too, even though the edge-function side truncates independently.
export async function listActiveDraftMemoryRules() {
  const all = await listDraftMemoryRules()
  return all.filter(r => r.status === 'active').slice(0, MAX_ACTIVE_RULES)
}

// Creates a PENDING rule — never active on write. `source: 'confirmed'`
// means it came from Eddie clicking "Remember this rule" on an AI reply;
// `source: 'admin'` means it was typed directly into the review list.
// Idempotent: re-saving text that (case/whitespace-insensitively) matches an
// existing pending/active rule just touches that rule's updatedAt instead of
// creating a duplicate.
export async function createDraftMemoryRule({ text, source = 'confirmed', createdBy }) {
  const clean = String(text || '').trim()
  if (!clean) throw new Error('Rule text is required.')
  if (wordCount(clean) > MAX_RULE_WORDS) {
    throw new Error(`Keep a rule to ${MAX_RULE_WORDS} words or fewer — this is ${wordCount(clean)}.`)
  }
  const existing = await listDraftMemoryRules()
  const dupe = existing.find(r => r.status !== 'disabled' && normalize(r.text) === normalize(clean))
  if (dupe) {
    await updateDoc(doc(db, 'draft_memory_rules', dupe.id), { updatedAt: serverTimestamp() })
    return dupe.id
  }
  const ref = await addDoc(COL(), {
    text: clean,
    status: 'pending',
    source,
    createdAt: serverTimestamp(),
    createdBy: createdBy || null,
    reviewedAt: null,
    reviewedBy: null,
  })
  return ref.id
}

// Approves a pending rule into the live prompt set. Refuses past the active
// cap so the packet can never silently grow past what buildMemoryBlock()
// assumes — the reviewer has to disable something else first.
export async function approveDraftMemoryRule(ruleId, reviewerUid) {
  const active = await listActiveDraftMemoryRules()
  if (active.length >= MAX_ACTIVE_RULES) {
    throw new Error(`Already at the ${MAX_ACTIVE_RULES}-rule limit — disable one before approving another.`)
  }
  await updateDoc(doc(db, 'draft_memory_rules', ruleId), {
    status: 'active', reviewedAt: serverTimestamp(), reviewedBy: reviewerUid || null,
  })
}

export async function rejectDraftMemoryRule(ruleId, reviewerUid) {
  await updateDoc(doc(db, 'draft_memory_rules', ruleId), {
    status: 'disabled', reviewedAt: serverTimestamp(), reviewedBy: reviewerUid || null,
  })
}

export async function disableDraftMemoryRule(ruleId) {
  await updateDoc(doc(db, 'draft_memory_rules', ruleId), { status: 'disabled' })
}

export async function updateDraftMemoryRuleText(ruleId, text) {
  const clean = String(text || '').trim()
  if (!clean) throw new Error('Rule text is required.')
  if (wordCount(clean) > MAX_RULE_WORDS) {
    throw new Error(`Keep a rule to ${MAX_RULE_WORDS} words or fewer — this is ${wordCount(clean)}.`)
  }
  await updateDoc(doc(db, 'draft_memory_rules', ruleId), { text: clean })
}

export async function deleteDraftMemoryRule(ruleId) {
  await deleteDoc(doc(db, 'draft_memory_rules', ruleId))
}

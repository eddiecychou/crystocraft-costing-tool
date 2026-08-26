import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, orderBy, query, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

// Saved "what do you want to say?" topics for Daily Drafts — the owner
// re-types the same handful of topics (seasonal greetings, restock
// announcements, portal invites) over and over; this lets one be saved once
// and reused. Deliberately separate from draft_memory_rules (writing-style
// rules injected into every prompt) — a template is the topic text itself,
// picked once per batch, not a standing instruction.
const COL = () => collection(db, 'outreach_topic_templates')

export async function listTopicTemplates() {
  const snap = await getDocs(query(COL(), orderBy('created_at', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function saveTopicTemplate({ name, text }) {
  const ref = await addDoc(COL(), { name, text, created_at: serverTimestamp() })
  return ref.id
}

export async function updateTopicTemplate(id, { name, text }) {
  await updateDoc(doc(db, 'outreach_topic_templates', id), { name, text, updated_at: serverTimestamp() })
}

export async function deleteTopicTemplate(id) {
  await deleteDoc(doc(db, 'outreach_topic_templates', id))
}

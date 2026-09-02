// SEO control-plane state store (Step 1). Two things:
//   seo_state          — the current "what's live now" snapshot (chunked),
//                        restored on page open so WordPress isn't re-read
//                        every visit. Overwritten on Refresh.
//   seo_state_history  — APPEND-ONLY timestamped snapshots. This is the
//                        rollback reference: if a later WordPress change goes
//                        wrong, the last good snapshot says what each post's
//                        slug / status / SEO meta / layout hash used to be.
//
// Admin-only (firestore.rules). History docs are never updated or deleted.
import {
  doc, getDoc, setDoc, addDoc, getDocs, collection, serverTimestamp, query, orderBy, limit,
} from 'firebase/firestore'
import { db } from './firebase'

const MAX_BYTES = 900_000
const CHUNK = 500
const toDate = (v) => (typeof v?.toDate === 'function' ? v.toDate() : v instanceof Date ? v : null)

async function saveDoc(ref, payload) {
  const bytes = new Blob([JSON.stringify(payload)]).size
  if (bytes > MAX_BYTES) return { skipped: 'too_large', bytes }
  await setDoc(ref, { ...payload, saved_at: serverTimestamp() })
  return { ok: true, bytes }
}

// ── current state (chunked, mutable) ──────────────────────────────────────
export async function loadSeoState() {
  try {
    const head = await getDoc(doc(db, 'seo_state', 'head'))
    if (!head.exists()) return null
    const h = head.data()
    const parts = await Promise.all(
      Array.from({ length: h.chunks || 0 }, (_, i) => getDoc(doc(db, 'seo_state', `c${i}`))),
    )
    if (parts.some(p => !p.exists())) return null
    return { rows: parts.flatMap(p => p.data().rows || []), fetchedAt: toDate(h.saved_at) }
  } catch { return null }
}

export async function saveSeoState(rows) {
  const chunks = Math.max(1, Math.ceil(rows.length / CHUNK))
  for (let i = 0; i < chunks; i++) {
    const res = await saveDoc(doc(db, 'seo_state', `c${i}`), { rows: rows.slice(i * CHUNK, (i + 1) * CHUNK) })
    if (res.skipped) return res
  }
  await saveDoc(doc(db, 'seo_state', 'head'), { chunks, row_count: rows.length })
  return { ok: true }
}

// ── history (append-only) ─────────────────────────────────────────────────
// Rows are compact (ids, slugs, hashes — no bodies), so a full snapshot fits
// one doc. If it ever doesn't, the write is skipped and the caller is told.
export async function saveSeoSnapshot(rows, note = '') {
  const payload = { rows, row_count: rows.length, note: String(note).slice(0, 500), taken_at: serverTimestamp() }
  const bytes = new Blob([JSON.stringify(payload)]).size
  if (bytes > MAX_BYTES) return { skipped: 'too_large', bytes }
  const ref = await addDoc(collection(db, 'seo_state_history'), payload)
  return { ok: true, id: ref.id }
}

export async function listSeoSnapshots(max = 30) {
  try {
    const snap = await getDocs(query(collection(db, 'seo_state_history'), orderBy('taken_at', 'desc'), limit(max)))
    return snap.docs.map(d => {
      const x = d.data()
      return { id: d.id, takenAt: toDate(x.taken_at), rowCount: x.row_count || (x.rows || []).length, note: x.note || '' }
    })
  } catch { return [] }
}

export async function loadSeoSnapshot(id) {
  try {
    const d = await getDoc(doc(db, 'seo_state_history', id))
    if (!d.exists()) return null
    const x = d.data()
    return { id, rows: x.rows || [], takenAt: toDate(x.taken_at), note: x.note || '' }
  } catch { return null }
}

import { readAiResponse } from './aiResponse'
import { collection, onSnapshot, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db, authHeader } from './firebase'
import { MAX_COPY_CHARS } from './marketingCopyReview'
export { MAX_COPY_CHARS } from './marketingCopyReview'

export const JOB_KEY = 'oc-marketing-regeneration-v1'
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export function initialJob() {
  return { runId: crypto.randomUUID(), entries: {} }
}

export function loadJob() {
  try {
    const saved = JSON.parse(localStorage.getItem(JOB_KEY))
    return saved?.runId && saved.entries && typeof saved.entries === 'object' ? saved : initialJob()
  } catch {
    return initialJob()
  }
}

export function saveJob(job) {
  localStorage.setItem(JOB_KEY, JSON.stringify(job))
}

export async function readTarget(id) {
  const snap = await getDocFromServer(doc(db, 'products', id))
  if (!snap.exists()) throw new Error('Product no longer exists.')
  return { id, ...snap.data() }
}

export async function generatePreview(product, instructions = '') {
  const response = await fetch('/api/generate-marketing-copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ product, source: 'corporate', tone: 'professional and premium', instructions: instructions.trim() }),
  })
  const data = await readAiResponse(response)
  const after = data.marketing_description
  if (typeof after !== 'string' || !after.trim()) throw new Error('Generator returned empty copy.')
  if (after.length > MAX_COPY_CHARS) throw new Error(`Generator returned ${after.length} characters (> 300).`)
  return after
}

export async function applyApproved(id, entry, runId) {
  if (!entry.approved || entry.status !== 'previewed') throw new Error('This preview has not been approved.')
  if ((entry.guidance || '').trim() !== (entry.instructionsApplied || '')) throw new Error('Rewrite with the current instructions before approving.')
  if (!entry.after?.trim() || entry.after.length > MAX_COPY_CHARS) throw new Error('New copy is empty or over 300 characters.')
  const productRef = doc(db, 'products', id)
  const historyRef = doc(db, 'product_marketing_history', entry.previewId ? `${runId}_${id}_${entry.previewId}` : `${runId}_${id}`)
  await runTransaction(db, async tx => {
    const [productSnap, historySnap] = await Promise.all([tx.get(productRef), tx.get(historyRef)])
    if (!productSnap.exists()) throw new Error('Product no longer exists.')
    const current = productSnap.data().marketing_description || ''
    if (historySnap.exists()) {
      if (current === entry.after) return // Previous transaction committed; resume safely.
      throw new Error('Backup exists but product copy changed; inspect manually.')
    }
    if (current !== entry.before) throw new Error('Product copy changed since preview; regenerate before saving.')
    tx.set(historyRef, {
      product_id: id,
      run_id: runId,
      previous_description: current,
      replacement_description: entry.after,
      previous_chars: current.length,
      replacement_chars: entry.after.length,
      created_at: serverTimestamp(),
    })
    tx.update(productRef, { marketing_description: entry.after, updatedAt: serverTimestamp() })
  })
  const reread = await readTarget(id)
  if (reread.marketing_description !== entry.after) throw new Error('Write committed, but verification did not match; inspect before retrying.')
  return reread.marketing_description.length
}

export function watchReviewProducts(onProducts, onError) {
  // No orderBy: products without createdAt must also be included.
  return onSnapshot(collection(db, 'products'), snapshot => {
    onProducts(snapshot.docs.map(d => ({ ...d.data(), id: d.id })))
  }, onError)
}

export async function verifyTargets() {
  const snapshot = await getDocsFromServer(collection(db, 'products'))
  return snapshot.docs.map(d => ({ ...d.data(), id: d.id }))
}

import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db, authHeader } from './firebase'
import { TARGET_IDS } from './marketingRegenerationList'

export const MAX_COPY_CHARS = 300
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
  if (!TARGET_IDS.includes(id)) throw new Error('Product is outside the 114-item allowlist.')
  const snap = await getDocFromServer(doc(db, 'products', id))
  if (!snap.exists()) throw new Error('Product no longer exists.')
  return { id, ...snap.data() }
}

export async function generatePreview(product) {
  const response = await fetch('/api/generate-marketing-copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ product, source: 'corporate', tone: 'professional and premium' }),
  })
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error || `Generator returned HTTP ${response.status}.`)
  const after = data.marketing_description
  if (typeof after !== 'string' || !after.trim()) throw new Error('Generator returned empty copy.')
  if (after.length > MAX_COPY_CHARS) throw new Error(`Generator returned ${after.length} characters (> 300).`)
  return after
}

export async function applyApproved(id, entry, runId) {
  if (!TARGET_IDS.includes(id)) throw new Error('Product is outside the 114-item allowlist.')
  if (!entry.approved || entry.status !== 'previewed') throw new Error('This preview has not been approved.')
  if (!entry.after?.trim() || entry.after.length > MAX_COPY_CHARS) throw new Error('New copy is empty or over 300 characters.')
  const productRef = doc(db, 'products', id)
  const historyRef = doc(db, 'product_marketing_history', `${runId}_${id}`)
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

export async function verifyTargets(onProgress = () => {}) {
  const results = []
  // Serial reads avoid a burst of 114 concurrent requests and make errors explicit.
  for (const id of TARGET_IDS) {
    try {
      const product = await readTarget(id)
      const copy = product.marketing_description || ''
      results.push({ id, name: product.name || id, chars: copy.length, hasCopy: Boolean(copy.trim()), overLimit: copy.length > MAX_COPY_CHARS })
    } catch (error) {
      results.push({ id, name: id, chars: 0, hasCopy: false, overLimit: false, error: error.message })
    }
    onProgress(results.length)
  }
  return results
}

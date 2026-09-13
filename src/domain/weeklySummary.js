import { collectionGroup, collection, doc, getDoc, getDocs, query, where, orderBy, Timestamp, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, authedUser } from '../firebase'

// Dashboard "This Week" section (V8.15) — a per-customer AI digest of what
// happened in the last 7 days, built from the two channels that are
// actually kept current day-to-day: the CRM Interaction Log (`enquiries`,
// hand-logged) and ingested email (`email_threads`, synced daily by
// email-sync/sync.py). WhatsApp/Alibaba are deliberately excluded for now
// (Eddie: "not the most updated communication channels") — see
// PROJECT-PLAN.md's V8.15 entry if that changes.
//
// On-demand only (no scheduled job): generateWeeklySummary() is called from
// a Dashboard "Refresh" button, result cached in dashboard_cache/weekly_summary
// so reopening the dashboard doesn't require a fresh AI call every time.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const CACHE_DOC = doc(db, 'dashboard_cache', 'weekly_summary')

// Same split every other AI feature here uses: the browser holds Firestore
// access and does all the reading; the edge function only holds the
// DEEPSEEK_API_KEY secret.
async function authedPost(path, body) {
  const user = await authedUser()
  if (!user) throw new Error('Please sign in.')
  const token = await user.getIdToken()
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// A customer's own enquiries/email_threads live at customers/{id}/... — a
// collectionGroup query returns docs from EVERY parent collection sharing
// that subcollection name (marketing_contacts too), so filter to just
// customers/{id} parents here rather than widening scope beyond what was
// asked for.
function customerIdOf(docSnap) {
  const customerRef = docSnap.ref.parent.parent // customers/{id} (or marketing_contacts/{id} — excluded below)
  if (!customerRef) return null
  return customerRef.parent?.id === 'customers' ? customerRef.id : null
}

async function activityFromEnquiries(cutoffDate) {
  const cutoffTs = Timestamp.fromDate(cutoffDate)
  const snap = await getDocs(
    query(collectionGroup(db, 'enquiries'), where('date', '>=', cutoffTs), orderBy('date', 'desc')),
  )
  const byCustomer = new Map()
  for (const d of snap.docs) {
    const customerId = customerIdOf(d)
    if (!customerId) continue
    const r = d.data()
    if (!byCustomer.has(customerId)) byCustomer.set(customerId, [])
    byCustomer.get(customerId).push({
      date: r.date?.toDate?.() || null,
      channel: r.channel || 'Email',
      description: String(r.description || '').slice(0, 400),
    })
  }
  return byCustomer
}

async function activityFromEmailThreads(cutoffDate) {
  const cutoffIso = cutoffDate.toISOString()
  // synced_at is a plain ISO string (email-sync/sync.py), not a Firestore
  // Timestamp — string comparison sorts correctly for zero-padded ISO 8601.
  const snap = await getDocs(
    query(collectionGroup(db, 'email_threads'), where('synced_at', '>=', cutoffIso)),
  )
  const byCustomer = new Map()
  for (const d of snap.docs) {
    const customerId = customerIdOf(d)
    if (!customerId) continue
    const r = d.data()
    const recentMessages = (r.messages || []).filter(m => m.date && m.date >= cutoffIso)
    if (recentMessages.length === 0) continue // thread touched by sync, but its actual new messages predate the cutoff
    if (!byCustomer.has(customerId)) byCustomer.set(customerId, [])
    byCustomer.get(customerId).push({
      subject: r.subject || '(no subject)',
      messages: recentMessages.map(m => ({
        date: m.date,
        from: m.from || '',
        snippet: String(m.body_text || '').slice(0, 300),
      })),
    })
  }
  return byCustomer
}

function renderCustomerText(enquiries = [], threads = []) {
  const parts = []
  if (enquiries.length > 0) {
    parts.push('=== CRM Interaction Log ===')
    for (const e of enquiries) {
      const d = e.date ? e.date.toLocaleDateString('en-GB') : '?'
      parts.push(`[${d}] (${e.channel}) ${e.description}`)
    }
  }
  if (threads.length > 0) {
    parts.push('=== Email ===')
    for (const t of threads) {
      parts.push(`Subject: ${t.subject}`)
      for (const m of t.messages) {
        parts.push(`  [${m.date.slice(0, 10)}] from ${m.from}: ${m.snippet}`)
      }
    }
  }
  return parts.join('\n').slice(0, 4000) // per-customer cap — this is a week's worth, not a full history
}

// Step 1 — gather this week's raw activity, grouped per customer, with no
// AI call yet. Exposed separately from generateWeeklySummary so the
// Dashboard can show "N customers active this week" immediately, before
// the (slower) digest call resolves.
export async function findActiveCustomers() {
  const cutoff = new Date(Date.now() - WEEK_MS)
  const [enquiriesByCustomer, threadsByCustomer] = await Promise.all([
    activityFromEnquiries(cutoff),
    activityFromEmailThreads(cutoff),
  ])
  const ids = new Set([...enquiriesByCustomer.keys(), ...threadsByCustomer.keys()])
  const entries = await Promise.all([...ids].map(async (id) => {
    const custSnap = await getDoc(doc(db, 'customers', id))
    const name = custSnap.exists() ? (custSnap.data().company_name || custSnap.data().name || 'Unnamed customer') : 'Unknown customer'
    const enquiries = enquiriesByCustomer.get(id) || []
    const threads = threadsByCustomer.get(id) || []
    const channels = new Set(enquiries.map(e => e.channel))
    if (threads.length > 0) channels.add('Email')
    const lastActivity = [
      ...enquiries.map(e => e.date),
      ...threads.flatMap(t => t.messages.map(m => new Date(m.date))),
    ].filter(Boolean).sort((a, b) => b - a)[0] || null
    return {
      customerId: id,
      customerName: name,
      channels: [...channels],
      lastActivity,
      text: renderCustomerText(enquiries, threads),
    }
  }))
  return entries.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
}

// Step 2 — one batched DeepSeek call covering every active customer (not
// one call each), then cache the result. Called from the Dashboard's
// "Refresh" button.
export async function generateWeeklySummary() {
  const entries = await findActiveCustomers()
  if (entries.length === 0) {
    const empty = { generatedAt: serverTimestamp(), weekStart: new Date(Date.now() - WEEK_MS).toISOString(), items: [] }
    await setDoc(CACHE_DOC, empty)
    return { items: [] }
  }

  const { digests } = await authedPost('/api/weekly-digest', {
    customers: entries.map(e => ({ id: e.customerId, name: e.customerName, text: e.text })),
  })
  const digestById = new Map((digests || []).map(d => [d.id, d.digest]))

  const items = entries.map(e => ({
    customerId: e.customerId,
    customerName: e.customerName,
    channels: e.channels,
    lastActivity: e.lastActivity ? e.lastActivity.toISOString() : null,
    digest: digestById.get(e.customerId) || '(no digest returned)',
  }))

  await setDoc(CACHE_DOC, { generatedAt: serverTimestamp(), weekStart: new Date(Date.now() - WEEK_MS).toISOString(), items })
  return { items }
}

export async function loadWeeklySummary() {
  const snap = await getDoc(CACHE_DOC)
  return snap.exists() ? snap.data() : null
}

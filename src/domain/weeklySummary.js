import { collectionGroup, collection, doc, getDoc, getDocs, query, where, orderBy, Timestamp, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, authedUser } from '../firebase'
import { NOT_CUSTOMER_TAG } from './customer'

// Dashboard "This Month" section (V8.15, extended 2026-09-17) — a per-customer
// AI digest of what happened in the last 30 days, built from the two channels
// that are actually kept current day-to-day: the CRM Interaction Log
// (`enquiries`, hand-logged) and ingested email (`email_threads`, synced
// daily by email-sync/sync.py). WhatsApp/Alibaba are deliberately excluded
// for now (Eddie: "not the most updated communication channels") — see
// PROJECT-PLAN.md's V8.15 entry if that changes.
//
// Originally a 7-day window; widened to 30 (Eddie: "not all issues are
// resolved in a week") — function/doc names below still say "weekly" to
// avoid an unnecessary rename churn, but the actual lookback is LOOKBACK_MS.
//
// On-demand only (no scheduled job): generateWeeklySummary() is called from
// a Dashboard "Refresh" button, result cached in dashboard_cache/weekly_summary
// so reopening the dashboard doesn't require a fresh AI call every time.
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
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

// Sender-level noise exclusion (Eddie, 2026-09-17, correcting the earlier
// customer-level NOT_CUSTOMER_TAG attempt): "HSBC Commercial Banking" and
// "Dazzling Giftz Enterprise" ARE real customers (their crm tags say so) —
// email-sync's domain-based matching just also swept in unrelated mail onto
// the SAME customer record: Crystocraft's own HSBC bank-notification bots
// (@hsbc.com.hk, same domain as the real HSBC relationship-manager contact),
// and Dazzling Giftz's own outbound marketing blasts (sales@dazzling-giftz.com).
// Excluding these SENDERS from the digest input keeps any real correspondence
// on the same customer record intact — excluding the whole customer would have
// thrown that away too. Matched case-insensitively as a substring of `from`
// (a raw "Name <addr>" header, not a clean address) — extend this list as
// more notification/marketing-bot senders turn up on real customer records.
const EXCLUDED_SENDER_PATTERNS = [
  'payment.notification@hsbc.com.hk',
  'estatement.and.eadvice',
  'business.banking@hsbc.com.hk',
  'businessinternetbanking@hsbc.com.hk',
  'instantadvice@hsbc.com.hk',
  'support-visiongo@hsbc.com.hk',
  'support-businessgo@hsbc.com.hk',
  'sales@dazzling-giftz.com',
]
function isExcludedSender(from) {
  const f = (from || '').toLowerCase()
  return EXCLUDED_SENDER_PATTERNS.some(p => f.includes(p))
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
    const recentMessages = (r.messages || [])
      .filter(m => m.date && m.date >= cutoffIso)
      .filter(m => !isExcludedSender(m.from))
    if (recentMessages.length === 0) continue // thread touched by sync, but nothing left after the cutoff/sender filters
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
  return parts.join('\n').slice(0, 6000) // per-customer cap — a month's worth, not a full history (bumped from 4000 alongside the 7d->30d window)
}

// Step 1 — gather the trailing month's raw activity, grouped per customer, with no
// AI call yet. Exposed separately from generateWeeklySummary so the
// Dashboard can show "N customers active this month" immediately, before
// the (slower) digest call resolves.
export async function findActiveCustomers() {
  const cutoff = new Date(Date.now() - LOOKBACK_MS)
  const [enquiriesByCustomer, threadsByCustomer] = await Promise.all([
    activityFromEnquiries(cutoff),
    activityFromEmailThreads(cutoff),
  ])
  const ids = new Set([...enquiriesByCustomer.keys(), ...threadsByCustomer.keys()])
  const entries = await Promise.all([...ids].map(async (id) => {
    const custSnap = await getDoc(doc(db, 'customers', id))
    // Not every `customers` doc is a real relationship — a personal/company
    // bank account or an inbound marketing email can get matched here by
    // email-sync just like a genuine customer would. Tagged with
    // NOT_CUSTOMER_TAG (via the ordinary tag editor), excluded here entirely
    // rather than just not mentioned — no point spending a raw activity
    // read/render on something that'll never appear in the digest.
    if (custSnap.exists() && (custSnap.data().tags || []).includes(NOT_CUSTOMER_TAG)) return null
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
  return entries.filter(Boolean).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
}

// Step 2 — one batched DeepSeek call covering every active customer (not
// one call each), then cache the result. Called from the Dashboard's
// "Refresh" button.
export async function generateWeeklySummary() {
  const entries = await findActiveCustomers()
  if (entries.length === 0) {
    const empty = { generatedAt: serverTimestamp(), weekStart: new Date(Date.now() - LOOKBACK_MS).toISOString(), items: [] }
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

  await setDoc(CACHE_DOC, { generatedAt: serverTimestamp(), weekStart: new Date(Date.now() - LOOKBACK_MS).toISOString(), items })
  return { items }
}

export async function loadWeeklySummary() {
  const snap = await getDoc(CACHE_DOC)
  return snap.exists() ? snap.data() : null
}

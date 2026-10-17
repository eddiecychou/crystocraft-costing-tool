import { collectionGroup, collection, doc, getDoc, getDocs, query, where, orderBy, Timestamp, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, authedUser } from '../firebase'
import { NOT_CUSTOMER_TAG, RETAIL_TAG } from './customer'
import { summaryDays, summaryCacheId, summarySource } from '../customerSummary'

// On-demand shared CRM/email/WhatsApp summaries for 14, 30 or 90 days.
// Each period has its own cache; generating summaries never changes saved tasks
// or confirmed Pipeline. All customers are processed in bounded AI batches.
const CACHE_DOC = days => doc(db, 'dashboard_cache', summaryCacheId(days))

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
        snippet: String(m.body_text || '').slice(0, 600),
      })),
    })
  }
  return byCustomer
}

// WhatsApp has no `synced_at` and no collection-group rule (unlike email), so
// this is a per-customer read of whatsapp_threads — a few hundred customers,
// fine for the on-demand digest. Skips tombstoned (migrated_to) threads, which
// are re-keyed sources that no longer represent live history.
async function activityFromWhatsappThreads(cutoffDate) {
  const cutoffIso = cutoffDate.toISOString()
  const byCustomer = new Map()
  const customers = await getDocs(collection(db, 'customers'))
  for (const c of customers.docs) {
    const snap = await getDocs(collection(db, 'customers', c.id, 'whatsapp_threads'))
    for (const d of snap.docs) {
      const r = d.data()
      if (r.migrated_to) continue
      const recentMessages = (r.messages || []).filter(m => m.date && m.date >= cutoffIso)
      if (recentMessages.length === 0) continue
      if (!byCustomer.has(c.id)) byCustomer.set(c.id, [])
      byCustomer.get(c.id).push({
        subject: r.subject || '(no subject)',
        channel: r.channel || 'WhatsApp',
        messages: recentMessages.map(m => ({
          date: m.date,
          from: m.from || '',
          snippet: String(m.body_text || '').slice(0, 600),
        })),
      })
    }
  }
  return byCustomer
}

// Step 1 — gather the trailing month's raw activity, grouped per customer, with no
// AI call yet. Exposed separately from generateWeeklySummary so the
// Dashboard can show "N customers active this month" immediately, before
// the (slower) digest call resolves.
export async function findActiveCustomers(days = 30) {
  const cutoff = new Date(Date.now() - summaryDays(days) * 86400000)
  const [enquiriesByCustomer, threadsByCustomer, whatsappByCustomer] = await Promise.all([
    activityFromEnquiries(cutoff),
    activityFromEmailThreads(cutoff),
    activityFromWhatsappThreads(cutoff),
  ])
  const ids = new Set([...enquiriesByCustomer.keys(), ...threadsByCustomer.keys(), ...whatsappByCustomer.keys()])
  const entries = await Promise.all([...ids].map(async (id) => {
    const custSnap = await getDoc(doc(db, 'customers', id))
    // Not every `customers` doc is a real relationship — a personal/company
    // bank account or an inbound marketing email can get matched here by
    // email-sync just like a genuine customer would. Tagged with
    // NOT_CUSTOMER_TAG (via the ordinary tag editor), excluded here entirely
    // rather than just not mentioned — no point spending a raw activity
    // read/render on something that'll never appear in the digest.
    //
    // Retail/B2C customers excluded too (Eddie, 2026-09-17: "too many names,
    // not much importance... transaction amount is very small compared to
    // B2B" — e.g. Tiffany Mak). Same RETAIL_TAG ProductDetail.jsx's "branded
    // for" picker already filters on — B2C is a tag, not a crm_category, so
    // this can't be a query filter and has to be this same read-then-check.
    if (!custSnap.exists()) return null
    if (custSnap.exists()) {
      const tags = custSnap.data().tags || []
      if (tags.includes(NOT_CUSTOMER_TAG) || tags.includes(RETAIL_TAG)) return null
    }
    const name = custSnap.exists() ? (custSnap.data().company_name || custSnap.data().name || 'Unnamed customer') : 'Unknown customer'
    const enquiries = enquiriesByCustomer.get(id) || []
    const threads = threadsByCustomer.get(id) || []
    const whatsappThreads = whatsappByCustomer.get(id) || []
    const channels = new Set(enquiries.map(e => e.channel))
    if (threads.length > 0) channels.add('Email')
    for (const t of whatsappThreads) channels.add(t.channel || 'WhatsApp')
    const lastActivity = [
      ...enquiries.map(e => e.date),
      ...threads.flatMap(t => t.messages.map(m => new Date(m.date))),
      ...whatsappThreads.flatMap(t => t.messages.map(m => new Date(m.date))),
    ].filter(Boolean).sort((a, b) => b - a)[0] || null
    return {
      customerId: id,
      customerName: name,
      channels: [...channels],
      lastActivity,
      ...summarySource(enquiries, threads, whatsappThreads),
    }
  }))
  return entries.filter(Boolean).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
}

// Step 2 — one batched DeepSeek call covering every active customer (not
// one call each), then cache the result. Called from the Dashboard's
// "Refresh" button.
export async function generateWeeklySummary(days = 30, onProgress = () => {}) {
  days=summaryDays(days)
  const entries = await findActiveCustomers(days)
  if (entries.length === 0) {
    const empty = { generatedAt: serverTimestamp(), lookbackDays:days, weekStart: new Date(Date.now() - days * 86400000).toISOString(), items: [] }
    await setDoc(CACHE_DOC(days), empty)
    return { items: [], lookbackDays:days }
  }

  const digests=[]
  for(let start=0;start<entries.length;start+=6){
    const batch=entries.slice(start,start+6)
    const data=await authedPost('/api/weekly-digest',{lookbackDays:days,customers:batch.map(e=>({id:e.customerId,name:e.customerName,text:e.text}))})
    const wanted=new Set(batch.map(e=>e.customerId))
    if(!Array.isArray(data.digests)||data.digests.length!==batch.length||new Set(data.digests.map(d=>d.id)).size!==batch.length||data.digests.some(d=>!wanted.has(d.id)||typeof d.digest!=='string'||!d.digest.trim()))throw Error('Incomplete summaries returned. Previous saved summaries are unchanged; please retry.')
    digests.push(...data.digests);onProgress(Math.min(start+6,entries.length),entries.length)
  }
  const digestById = new Map(digests.map(d => [d.id, d.digest]))

  const items = entries.map(e => ({
    customerId: e.customerId,
    customerName: e.customerName,
    channels: e.channels,
    lastActivity: e.lastActivity ? e.lastActivity.toISOString() : null,
    digest: digestById.get(e.customerId), sourceLimited:e.limited,
  }))

  await setDoc(CACHE_DOC(days), { generatedAt: serverTimestamp(), lookbackDays:days, weekStart: new Date(Date.now() - days * 86400000).toISOString(), items })
  return { items, lookbackDays:days }
}

export async function loadWeeklySummary(days=30) {
  const snap = await getDoc(CACHE_DOC(days))
  return snap.exists() ? snap.data() : null
}

import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { Send, Loader2, SkipForward, Sparkles } from 'lucide-react'
import { db, authedUser } from '../firebase'
import { loadCustomers, primaryContact } from '../domain/customer'
import { listPendingDrafts, listSentDraftsForProduct, createDrafts, markDraftSent, skipDraft } from '../domain/outreachDrafts'
import { generateDrafts, sendPersonalEmail } from '../outreachApi'

// Daily Drafts re-engagement engine (V7.23) — pick a product, generate 10-20
// AI-drafted personal emails against the eligible customer pool, review and
// send one at a time. See PROJECT-PLAN.md V7.23 and the plan this shipped
// from for why matching is AI fit-scoring rather than a hand-built category
// map, and why there's no persistent "recommended pick" flag yet — the owner
// wants to pick the product manually while this is still new.

const COOLDOWN_DAYS = 14        // don't re-suggest a customer within this many days of their last outreach
const PRODUCT_COOLDOWN_DAYS = 21 // don't re-suggest the SAME product to someone already sent it recently
const MAX_CANDIDATES = 60        // sent to fit-scoring; protects DeepSeek rate limits and function run time

const daysAgo = (ts) => {
  if (!ts) return Infinity
  const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime()
  return (Date.now() - ms) / 86400000
}

// Eligible candidates: active/prospect, has a contactable email, not
// manually blocked, cooldown-cleared, never sent THIS product recently.
// Capped and prioritized (never-contacted first, then longest since last
// contact) rather than sent unbounded — see MAX_CANDIDATES above.
function eligibleCandidates(customers, recentlySentIds) {
  const now = Date.now()
  const pool = customers.filter(c => {
    if (!['Active', 'Prospect'].includes(c.crm_status)) return false
    const contact = primaryContact(c.contacts)
    if (!contact?.email) return false
    if (c.blockOutreachUntil) {
      const until = c.blockOutreachUntil.toMillis ? c.blockOutreachUntil.toMillis() : new Date(c.blockOutreachUntil).getTime()
      if (until > now) return false
    }
    if (daysAgo(c.lastOutreachAt) < COOLDOWN_DAYS) return false
    if (recentlySentIds.has(c.id)) return false
    return true
  })
  pool.sort((a, b) => daysAgo(b.lastOutreachAt) - daysAgo(a.lastOutreachAt)) // never-contacted (Infinity) sorts first
  return pool.slice(0, MAX_CANDIDATES).map(c => {
    const contact = primaryContact(c.contacts)
    return {
      id: c.id, name: c.company_name, email: contact.email,
      crm_category: c.crm_category, crm_status: c.crm_status,
      notes: c.notes, erp_code: c.erp_code,
    }
  })
}

export default function DailyDrafts() {
  const [products, setProducts] = useState([])
  const [productId, setProductId] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [edits, setEdits] = useState({}) // draftId -> { subject, body }

  useEffect(() => {
    getDocs(query(collection(db, 'products'), orderBy('name'))).then(snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    reload()
  }, [])

  function reload() {
    setLoading(true)
    listPendingDrafts().then(setDrafts).finally(() => setLoading(false))
  }

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) return products.slice(0, 50)
    return products.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 50)
  }, [products, productQuery])

  async function handleGenerate() {
    const product = products.find(p => p.id === productId)
    if (!product) { setError('Pick a product first.'); return }
    setGenerating(true); setError('')
    try {
      const [customers, sentDrafts] = await Promise.all([
        loadCustomers(),
        listSentDraftsForProduct(product.id).then(list => list.filter(d => daysAgo(d.sentAt) < PRODUCT_COOLDOWN_DAYS)),
      ])
      const recentlySentIds = new Set(sentDrafts.map(d => d.customerId))
      const candidates = eligibleCandidates(customers, recentlySentIds)
      if (!candidates.length) { setError('No eligible customers right now (cooldowns/blocks cleared the whole pool).'); return }

      const generated = await generateDrafts(
        { id: product.id, name: product.name, description: product.description, category: product.category },
        candidates
      )
      if (!generated.length) { setError('DeepSeek returned no usable drafts — try again.'); return }
      await createDrafts(product, generated)
      reload()
    } catch (e) {
      setError(e.message || 'Could not generate drafts.')
    } finally {
      setGenerating(false)
    }
  }

  function fieldsFor(d) {
    return edits[d.id] || { subject: d.draftSubject, body: d.draftBody }
  }
  function setField(draftId, key, value) {
    setEdits(prev => ({
      ...prev,
      [draftId]: { ...fieldsFor(drafts.find(d => d.id === draftId) || {}), ...prev[draftId], [key]: value },
    }))
  }

  async function handleSend(d) {
    const { subject, body } = fieldsFor(d)
    setBusyId(d.id); setError('')
    try {
      await sendPersonalEmail({ customerEmail: d.customerEmail, subject, body })
      const user = await authedUser()
      await markDraftSent(d.id, user?.uid)
      await updateDoc(doc(db, 'customers', d.customerId), { lastOutreachAt: serverTimestamp() })
      setDrafts(prev => prev.filter(x => x.id !== d.id))
    } catch (e) {
      setError(e.message || 'Send failed.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleSkip(d) {
    const reason = window.prompt('Why skip this one? (optional)') || ''
    setBusyId(d.id); setError('')
    try {
      const user = await authedUser()
      await skipDraft(d.id, user?.uid, reason)
      setDrafts(prev => prev.filter(x => x.id !== d.id))
    } catch (e) {
      setError(e.message || 'Could not skip.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-8">
      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Generate today's drafts</h2>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Product to feature</label>
          <input value={productQuery} onChange={e => { setProductQuery(e.target.value); setProductId('') }}
            placeholder="Search products…" className="input w-full md:w-96 mb-1" />
          {productQuery && !productId && (
            <div className="border border-ivory-dark rounded max-h-48 overflow-y-auto w-full md:w-96">
              {filteredProducts.map(p => (
                <button key={p.id} type="button"
                  onClick={() => { setProductId(p.id); setProductQuery(p.name) }}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-ivory-light">
                  {p.name}
                </button>
              ))}
              {!filteredProducts.length && <div className="px-3 py-1.5 text-sm text-gray-400">No matches.</div>}
            </div>
          )}
        </div>
        <button onClick={handleGenerate} disabled={generating || !productId} className="btn-primary inline-flex items-center gap-1.5">
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generating ? 'Generating…' : 'Generate Drafts'}
        </button>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Pending review ({drafts.length})</h2>
        {drafts.length === 0 && <div className="text-sm text-gray-400">No drafts waiting — generate some above.</div>}
        {drafts.map(d => {
          const fields = fieldsFor(d)
          const isBusy = busyId === d.id
          return (
            <div key={d.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{d.customerName} <span className="text-gray-400 font-normal">— {d.customerEmail}</span></div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {d.productName} · fit {Math.round((d.fitScore || 0) * 100)}%
                    {d.fitReason && <span className="text-gray-400"> — {d.fitReason}</span>}
                  </div>
                </div>
              </div>
              <input value={fields.subject} onChange={e => setField(d.id, 'subject', e.target.value)}
                className="input w-full text-sm font-medium" />
              <textarea value={fields.body} onChange={e => setField(d.id, 'body', e.target.value)}
                rows={4} className="input w-full text-sm" />
              <div className="flex items-center gap-2">
                <button onClick={() => handleSend(d)} disabled={isBusy} className="btn-primary shrink-0 inline-flex items-center gap-1.5">
                  {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {isBusy ? 'Sending…' : 'Send'}
                </button>
                <button onClick={() => handleSkip(d)} disabled={isBusy} className="btn-secondary shrink-0 inline-flex items-center gap-1.5">
                  <SkipForward size={14} /> Skip
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

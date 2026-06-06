import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'

const CHANNELS  = ['Email', 'WhatsApp', 'Alibaba', 'Personal WhatsApp']
const STATUSES  = ['Open', 'Quoted', 'Won', 'Lost', 'On Hold']

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function tsToDateStr(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d.toISOString().split('T')[0]
}

export default function EnquiryForm({ customerId, customerQuotes = [], enquiry = null, onSave, onClose }) {
  const isEdit = Boolean(enquiry)

  const [date, setDate]               = useState(todayStr())
  const [description, setDescription] = useState('')
  const [channel, setChannel]         = useState('')
  const [status, setStatus]           = useState('Open')
  const [followUpDate, setFollowUpDate] = useState('')
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [linkedQuoteIds, setLinkedQuoteIds] = useState([])
  const [productSearch, setProductSearch] = useState('')
  const [selectedProducts, setSelectedProducts] = useState([])
  const [allProducts, setAllProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch products for interest picker
  useEffect(() => {
    getDocs(collection(db, 'products')).then(snap => {
      setAllProducts(snap.docs.map(d => ({ id: d.id, name: d.data().name || d.data().product_name || '' })).sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  // Populate form when editing
  useEffect(() => {
    if (!enquiry) return
    setDate(tsToDateStr(enquiry.date) || todayStr())
    setDescription(enquiry.description || '')
    setChannel(enquiry.channel || '')
    setStatus(enquiry.status || 'Open')
    setFollowUpDate(tsToDateStr(enquiry.follow_up_date) || '')
    setOutcomeNotes(enquiry.outcome_notes || '')
    setLinkedQuoteIds(enquiry.linked_quote_ids || [])
    setSelectedProducts(enquiry.product_interest || [])
  }, [enquiry])

  function toggleProduct(name) {
    setSelectedProducts(p => p.includes(name) ? p.filter(x => x !== name) : [...p, name])
  }

  function toggleQuote(qid) {
    setLinkedQuoteIds(ids => ids.includes(qid) ? ids.filter(x => x !== qid) : [...ids, qid])
  }

  const filteredProducts = allProducts.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  )

  async function handleSubmit(e) {
    e.preventDefault()
    if (!description.trim()) { setError('Description is required.'); return }
    setLoading(true)
    setError('')
    try {
      const payload = {
        date:             date ? Timestamp.fromDate(new Date(date)) : Timestamp.now(),
        description:      description.trim(),
        product_interest: selectedProducts,
        channel,
        status,
        follow_up_date:   followUpDate ? Timestamp.fromDate(new Date(followUpDate)) : null,
        outcome_notes:    outcomeNotes.trim(),
        linked_quote_ids: linkedQuoteIds,
        updatedAt:        serverTimestamp(),
      }
      if (isEdit) {
        await updateDoc(doc(db, 'customers', customerId, 'enquiries', enquiry.id), payload)
      } else {
        await addDoc(collection(db, 'customers', customerId, 'enquiries'), {
          ...payload,
          createdAt: serverTimestamp(),
        })
      }
      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-lg bg-white flex flex-col h-full shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Interaction' : 'Log Interaction'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Date + Channel */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="label">Channel</label>
              <select className="input" value={channel} onChange={e => setChannel(e.target.value)}>
                <option value="">— Select —</option>
                {CHANNELS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="label">Description *</label>
            <textarea
              className="input"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Asked about crystal fabric roses for Arribas Disney — confirmed 3 sample colours"
              required
            />
          </div>

          {/* Status */}
          <div>
            <label className="label">Status</label>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    status === s
                      ? STATUS_SELECTED[s]
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Products of interest */}
          <div>
            <label className="label">Products of Interest</label>
            {selectedProducts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedProducts.map(p => (
                  <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">
                    {p}
                    <button type="button" onClick={() => toggleProduct(p)} className="hover:text-brand-900 leading-none">×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              className="input text-sm"
              placeholder="Search products…"
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
            />
            {productSearch && (
              <div className="border border-gray-200 rounded-lg mt-1 max-h-36 overflow-y-auto divide-y divide-gray-100">
                {filteredProducts.length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">No products found</p>
                ) : filteredProducts.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { toggleProduct(p.name); setProductSearch('') }}
                    className={`w-full text-left text-sm px-3 py-2 hover:bg-gray-50 transition-colors ${selectedProducts.includes(p.name) ? 'text-brand-600 font-medium' : 'text-gray-700'}`}
                  >
                    {selectedProducts.includes(p.name) ? '✓ ' : ''}{p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Follow-up date */}
          <div>
            <label className="label">Follow-up Date <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="date" className="input" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
          </div>

          {/* Outcome notes */}
          <div>
            <label className="label">Outcome Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              className="input"
              rows={2}
              value={outcomeNotes}
              onChange={e => setOutcomeNotes(e.target.value)}
              placeholder="What happened / result"
            />
          </div>

          {/* Linked quotes */}
          {customerQuotes.length > 0 && (
            <div>
              <label className="label">Linked Quotes <span className="text-gray-400 font-normal">(optional)</span></label>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {customerQuotes.map(q => (
                  <label key={q.id} className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-brand-600"
                      checked={linkedQuoteIds.includes(q.id)}
                      onChange={() => toggleQuote(q.id)}
                    />
                    <span>
                      {q.createdAt?.toDate?.().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {q.quote_currency ? ` · ${q.quote_currency}` : ''}
                      {' · '}<span className={`capitalize ${q.status === 'won' ? 'text-green-600' : q.status === 'lost' ? 'text-red-500' : 'text-gray-500'}`}>{q.status || 'draft'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          <button onClick={handleSubmit} className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Log Interaction'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const STATUS_SELECTED = {
  Open:      'border-amber-400 bg-amber-50 text-amber-700',
  Quoted:    'border-blue-400 bg-blue-50 text-blue-700',
  Won:       'border-green-400 bg-green-50 text-green-700',
  Lost:      'border-red-400 bg-red-50 text-red-600',
  'On Hold': 'border-gray-400 bg-gray-100 text-gray-600',
}

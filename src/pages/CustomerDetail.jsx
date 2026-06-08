import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  doc, getDoc, deleteDoc, updateDoc, collection, query, where, getDocs,
  onSnapshot, deleteDoc as deleteDocument, serverTimestamp,
} from 'firebase/firestore'
import { db, storage } from '../firebase'
import { ref as storageRef, deleteObject } from 'firebase/storage'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingBar from '../components/LoadingBar'
import EnquiryForm from './EnquiryForm'

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean)
  if (val && typeof val === 'string') return [val]
  return []
}

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  sent:  'bg-blue-100 text-blue-700',
  won:   'bg-green-100 text-green-700',
  lost:  'bg-red-100 text-red-600',
}

const ENQUIRY_STATUS_STYLES = {
  Open:      'bg-amber-100 text-amber-700',
  Quoted:    'bg-blue-100 text-blue-700',
  Won:       'bg-green-100 text-green-700',
  Lost:      'bg-red-100 text-red-600',
  'On Hold': 'bg-gray-100 text-gray-500',
}

const ENQUIRY_STATUS_DOT = {
  Open:      'bg-amber-400',
  Quoted:    'bg-blue-500',
  Won:       'bg-green-500',
  Lost:      'bg-red-500',
  'On Hold': 'bg-gray-400',
}

const CRM_STATUS_STYLES = {
  Active:   'bg-green-100 text-green-700',
  Prospect: 'bg-blue-100 text-blue-700',
  Dormant:  'bg-amber-100 text-amber-700',
  Inactive: 'bg-gray-100 text-gray-500',
}

const CHANNEL_BADGE = {
  'Email':             'bg-purple-100 text-purple-700',
  'WhatsApp Business': 'bg-green-100 text-green-700',
  'Alibaba':           'bg-orange-100 text-orange-700',
  'Personal WhatsApp': 'bg-amber-100 text-amber-700',
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [customer, setCustomer]         = useState(null)
  const [quotes, setQuotes]             = useState([])
  const [enquiries, setEnquiries]       = useState([])
  const [loading, setLoading]           = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteEnquiry, setConfirmDeleteEnquiry] = useState(null)

  // Enquiry form state
  const [enquiryFormOpen, setEnquiryFormOpen] = useState(false)
  const [editingEnquiry, setEditingEnquiry]   = useState(null)
  const [removingAtt, setRemovingAtt]         = useState(null) // `${enquiryId}-${attIdx}`

  // Compose message state
  const [composeProduct, setComposeProduct]     = useState(null)   // { id, name, category, description }
  const [composeProductSearch, setComposeProductSearch] = useState('')
  const [composeProductOpen, setComposeProductOpen]     = useState(false)
  const [allProducts, setAllProducts]           = useState([])
  const [composeContext, setComposeContext]      = useState('')
  const [composeChannel, setComposeChannel]     = useState('')
  const [composeResult, setComposeResult]       = useState('')
  const [composeLoading, setComposeLoading]     = useState(false)
  const [composeError, setComposeError]         = useState('')
  const [composeCopied, setComposeCopied]       = useState(false)

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'customers', id)),
      getDocs(query(collection(db, 'client_quotes'), where('customer_id', '==', id))),
      getDocs(collection(db, 'products')),
    ]).then(([cSnap, qSnap, pSnap]) => {
      if (cSnap.exists()) {
        const c = { id: cSnap.id, ...cSnap.data() }
        setCustomer(c)
        setComposeChannel(c.channels?.[0] || c.primary_channel || '')
      }
      setQuotes(
        qSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      )
      setAllProducts(
        pSnap.docs
          .map(d => ({ id: d.id, name: d.data().name || '', category: d.data().category || '', description: d.data().description || '' }))
          .filter(p => p.name)
          .sort((a, b) => a.name.localeCompare(b.name))
      )
      setLoading(false)
    })
  }, [id])

  // Real-time enquiry listener (no orderBy — sort client-side)
  const [contextAutoFilled, setContextAutoFilled] = useState(false)
  useEffect(() => {
    const q = query(collection(db, 'customers', id, 'enquiries'))
    return onSnapshot(q, snap => {
      const sorted = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0))
      setEnquiries(sorted)
      // Auto-fill compose context from latest enquiry (once only)
      if (!contextAutoFilled && sorted.length > 0 && sorted[0].description) {
        setComposeContext(sorted[0].description)
        setContextAutoFilled(true)
      }
    })
  }, [id])

  async function handleDelete() {
    await deleteDoc(doc(db, 'customers', id))
    navigate('/customers')
  }

  async function handleDeleteEnquiry(enquiryId) {
    await deleteDocument(doc(db, 'customers', id, 'enquiries', enquiryId))
    setConfirmDeleteEnquiry(null)
  }

  async function handleRemoveAttachment(enq, attIdx) {
    const key = `${enq.id}-${attIdx}`
    setRemovingAtt(key)
    try {
      const atts = enq.attachments?.length
        ? enq.attachments
        : enq.attachment_url ? [{ url: enq.attachment_url, name: enq.attachment_name, path: enq.attachment_path }] : []
      const att = atts[attIdx]
      if (att?.path) { try { await deleteObject(storageRef(storage, att.path)) } catch {} }
      const updated = atts.filter((_, i) => i !== attIdx)
      await updateDoc(doc(db, 'customers', id, 'enquiries', enq.id), {
        attachments: updated,
        attachment_url: null, attachment_name: null, attachment_path: null,
        updatedAt: serverTimestamp(),
      })
    } finally {
      setRemovingAtt(null)
    }
  }

  async function handleCompose(e) {
    e.preventDefault()
    if (!composeContext.trim()) {
      setComposeError('Please describe the situation / what you want to say.')
      return
    }
    setComposeLoading(true)
    setComposeError('')
    setComposeResult('')
    try {
      const res = await fetch('/api/compose-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          product: composeProduct
            ? `${composeProduct.name}${composeProduct.category ? ` (${composeProduct.category})` : ''}${composeProduct.description ? ` — ${composeProduct.description}` : ''}`
            : 'General / Full Catalogue',
          channel: composeChannel,
          context: composeContext,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setComposeResult(data.message)
    } catch (err) {
      setComposeError(err.message || 'Failed to generate message.')
    } finally {
      setComposeLoading(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(composeResult).then(() => {
      setComposeCopied(true)
      setTimeout(() => setComposeCopied(false), 2000)
    })
  }

  if (loading) return <LoadingBar />
  if (!customer) return <div className="p-4 text-gray-500">Customer not found.</div>

  const followUpEnquiries = enquiries.filter(e => e.follow_up_date)

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <Link to="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>

      {/* Header */}
      <div className="mb-4 mt-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold text-gray-900">{customer.company_name}</h1>
              {customer.is_vip && <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold">⭐ VIP</span>}
              {customer.crm_status && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CRM_STATUS_STYLES[customer.crm_status] || 'bg-gray-100 text-gray-500'}`}>
                  {customer.crm_status}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{customer.country || customer.region || ''}</p>
            {customer.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customer.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-xs font-medium">{tag}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Link to={`/customers/${id}/edit`} className="btn-secondary text-sm">Edit</Link>
            <button className="btn-danger text-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        </div>
      </div>

      {/* Personal WA warning banner */}
      {(customer.is_personal_wa || customer.channels?.includes('Personal WhatsApp')) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>⚠️</span>
          <span>
            <strong>{customer.contact_name || customer.company_name}</strong> communicates via
            Eddie's <strong>personal WhatsApp</strong> — they will not appear in WhatsApp Business.
          </span>
        </div>
      )}

      {/* Contact info */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Contact Details</h2>
        <dl className="space-y-2">
          {customer.contact_name && <Row label="Contact" value={customer.contact_name} />}
          {toArray(customer.contact_emails ?? customer.contact_email).length > 0 && (
            <Row label="Email" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_emails ?? customer.contact_email).map((e, i) => (
                  <a key={i} href={`mailto:${e}`} className="text-brand-600 hover:underline block">{e}</a>
                ))}
              </div>
            } />
          )}
          {toArray(customer.contact_phones ?? customer.contact_phone).length > 0 && (
            <Row label="Phone" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_phones ?? customer.contact_phone).map((p, i) => (
                  <a key={i} href={`tel:${p}`} className="text-brand-600 hover:underline block">{p}</a>
                ))}
              </div>
            } />
          )}
          {toArray(customer.contact_whatsapps ?? customer.whatsapp).length > 0 && (
            <Row label="WhatsApp" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_whatsapps ?? customer.whatsapp).map((w, i) => (
                  <a key={i} href={`https://wa.me/${w.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline block">{w}</a>
                ))}
              </div>
            } />
          )}
          {toArray(customer.contact_wechats).length > 0 && (
            <Row label="WeChat" value={
              <div className="space-y-0.5">
                {toArray(customer.contact_wechats).map((w, i) => (
                  <span key={i} className="block text-gray-700">{w}</span>
                ))}
              </div>
            } />
          )}
          {customer.website && (
            <Row label="Website" value={
              <a href={customer.website} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline truncate block">{customer.website.replace(/^https?:\/\//, '')}</a>
            } />
          )}
          {customer.country && <Row label="Country" value={customer.country} />}
          {customer.address && <Row label="Address" value={customer.address} />}
          {/* CRM fields */}
          {customer.crm_category && (
            <Row label="Type" value={
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{customer.crm_category}</span>
            } />
          )}
          {(() => {
            const chs = customer.channels?.length ? customer.channels : customer.primary_channel ? [customer.primary_channel] : []
            return chs.length > 0 ? (
              <Row label="Channels" value={
                <div className="flex flex-wrap gap-1">
                  {chs.map(ch => (
                    <span key={ch} className={`px-2 py-0.5 rounded-full text-xs font-medium ${CHANNEL_BADGE[ch] || 'bg-gray-100 text-gray-600'}`}>
                      {ch}
                    </span>
                  ))}
                </div>
              } />
            ) : null
          })()}
          {customer.source && <Row label="Source" value={customer.source} />}
          {customer.segment && <Row label="Segment" value={customer.segment} />}
          {customer.folder_path && (
            <Row label="Folder" value={
              <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{customer.folder_path}</span>
            } />
          )}
        </dl>
      </div>

      {/* Notes */}
      {customer.notes && (
        <div className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Notes</h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{customer.notes}</p>
        </div>
      )}

      {/* Quote history */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Quotes ({quotes.length})</h2>
          <Link to={`/quotes/new?customer_id=${id}`} className="btn-primary text-xs py-1.5 px-3">+ New Quote</Link>
        </div>
        {quotes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No quotes yet for this customer.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {quotes.map(q => (
              <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {q.quote_date || q.createdAt?.toDate?.().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {q.item_count ? `${q.item_count} item${q.item_count > 1 ? 's' : ''}` : 'No items'}
                    {q.quote_currency ? ` · ${q.quote_currency}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`badge ${STATUS_STYLES[q.status] || STATUS_STYLES.draft}`}>{q.status || 'draft'}</span>
                  <span className="text-xs text-gray-400">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Interaction Log */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Interaction Log ({enquiries.length})</h2>
          <button
            onClick={() => { setEditingEnquiry(null); setEnquiryFormOpen(true) }}
            className="btn-primary text-xs py-1.5 px-3"
          >
            + Log Interaction
          </button>
        </div>

        {enquiries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No interactions logged yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {enquiries.map(enq => (
              <div key={enq.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Date · Channel · Status */}
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-xs text-gray-500">{fmtDate(enq.date)}</span>
                      {enq.channel && <span className="text-xs text-gray-400">· {enq.channel}</span>}
                      {enq.status && (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${ENQUIRY_STATUS_STYLES[enq.status] || 'bg-gray-100 text-gray-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${ENQUIRY_STATUS_DOT[enq.status] || 'bg-gray-400'}`} />
                          {enq.status}
                        </span>
                      )}
                    </div>
                    {/* Description */}
                    <p className="text-sm text-gray-800">{enq.description}</p>
                    {/* Products */}
                    {enq.product_interest?.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        <span className="font-medium">Products:</span> {enq.product_interest.join(', ')}
                      </p>
                    )}
                    {/* Follow-up + linked quotes */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {enq.follow_up_date && (
                        <p className={`text-xs font-medium ${isOverdue(enq.follow_up_date) ? 'text-red-600' : 'text-gray-500'}`}>
                          Follow-up: {fmtDate(enq.follow_up_date)}
                          {isOverdue(enq.follow_up_date) && ' ⚠️'}
                        </p>
                      )}
                      {enq.linked_quote_ids?.length > 0 && (
                        <p className="text-xs text-gray-500">
                          Linked: {enq.linked_quote_ids.length} quote{enq.linked_quote_ids.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    {/* Outcome notes */}
                    {enq.outcome_notes && (
                      <p className="text-xs text-gray-500 mt-1 italic">{enq.outcome_notes}</p>
                    )}
                    {/* Quote attachments */}
                    {(() => {
                      const atts = enq.attachments?.length
                        ? enq.attachments
                        : enq.attachment_url
                          ? [{ url: enq.attachment_url, name: enq.attachment_name || 'attachment', path: enq.attachment_path }]
                          : []
                      if (!atts.length) return null
                      return (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {atts.map((att, i) => (
                            <div key={i} className="relative group">
                              <a href={att.url} target="_blank" rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline"
                              >
                                {att.name?.match(/\.(jpg|jpeg|png|webp|gif)$/i)
                                  ? <img src={att.url} alt="" className="h-10 w-14 object-cover rounded border border-gray-200" />
                                  : <><span>📄</span><span className="truncate max-w-[140px]">{att.name || `Quote ${i + 1}`}</span></>
                                }
                              </a>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); handleRemoveAttachment(enq, i) }}
                                disabled={removingAtt === `${enq.id}-${i}`}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs leading-none flex items-center justify-center hover:bg-red-600"
                              >
                                {removingAtt === `${enq.id}-${i}` ? '…' : '×'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                  {/* Actions */}
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => { setEditingEnquiry(enq); setEnquiryFormOpen(true) }}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDeleteEnquiry(enq.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compose Message */}
      <div className="card mb-4">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">✦ Compose Message</h2>
          <p className="text-xs text-gray-400 mt-0.5">AI-written message tailored to this customer</p>
        </div>
        <div className="p-5 space-y-4">

          {/* Product picker */}
          <div>
            <label className="label">Product <span className="text-gray-400 font-normal">(optional)</span></label>
            {composeProduct ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-brand-200 bg-brand-50">
                <span className="text-sm font-medium text-brand-700 flex-1">{composeProduct.name}</span>
                {composeProduct.category && <span className="text-xs text-brand-500">{composeProduct.category}</span>}
                <button type="button" onClick={() => { setComposeProduct(null); setComposeProductSearch('') }} className="text-brand-400 hover:text-brand-700 text-lg leading-none">×</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  className="input"
                  placeholder="Search your products… (leave blank for general catalogue)"
                  value={composeProductSearch}
                  onChange={e => { setComposeProductSearch(e.target.value); setComposeProductOpen(true) }}
                  onFocus={() => setComposeProductOpen(true)}
                  onBlur={() => setTimeout(() => setComposeProductOpen(false), 150)}
                />
                {composeProductOpen && composeProductSearch && (
                  <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {allProducts.filter(p => p.name.toLowerCase().includes(composeProductSearch.toLowerCase())).length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">No products found</p>
                    ) : allProducts
                        .filter(p => p.name.toLowerCase().includes(composeProductSearch.toLowerCase()))
                        .map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={() => { setComposeProduct(p); setComposeProductSearch(''); setComposeProductOpen(false) }}
                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          >
                            <p className="text-sm font-medium text-gray-800">{p.name}</p>
                            {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                          </button>
                        ))
                    }
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Channel */}
          <div>
            <label className="label">Channel</label>
            <select className="input" value={composeChannel} onChange={e => setComposeChannel(e.target.value)}>
              <option value="">— Select —</option>
              {['Email', 'WhatsApp Business', 'Alibaba', 'Personal WhatsApp'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Situation / context — the main field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">What's the situation? *</label>
              {enquiries.length > 0 && (
                <button
                  type="button"
                  onClick={() => setComposeContext(enquiries[0].description || '')}
                  className="text-xs text-brand-600 hover:text-brand-800"
                >
                  ↺ Use latest interaction
                </button>
              )}
            </div>
            <textarea
              className="input"
              rows={4}
              value={composeContext}
              onChange={e => setComposeContext(e.target.value)}
              placeholder="Describe what you want to say or what's happening — e.g. 'They asked about crystal fabric roses last month, we now have 3 new colours, want to follow up and ask if they want samples'"
            />
          </div>

          <button onClick={handleCompose} disabled={composeLoading} className="btn-primary">
            {composeLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating…
              </span>
            ) : '✦ Generate Message'}
          </button>

          {composeError && <p className="text-sm text-red-600">{composeError}</p>}

          {composeResult && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Generated Message</label>
                <button onClick={handleCopy} className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                  {composeCopied ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
              <textarea
                className="input font-mono text-xs"
                rows={12}
                value={composeResult}
                onChange={e => setComposeResult(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Enquiry form drawer */}
      {enquiryFormOpen && (
        <EnquiryForm
          customerId={id}
          customerQuotes={quotes}
          enquiry={editingEnquiry}
          onSave={() => {}}
          onClose={() => { setEnquiryFormOpen(false); setEditingEnquiry(null) }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete ${customer.company_name}? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {confirmDeleteEnquiry && (
        <ConfirmDialog
          message="Delete this interaction? This cannot be undone."
          onConfirm={() => handleDeleteEnquiry(confirmDeleteEnquiry)}
          onCancel={() => setConfirmDeleteEnquiry(null)}
        />
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-20 text-gray-400 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{value}</dd>
    </div>
  )
}

function isOverdue(ts) {
  if (!ts) return false
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  return d < new Date()
}

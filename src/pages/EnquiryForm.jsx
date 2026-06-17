import { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'
import { Check, FileText, Image as ImageIcon, X, Paperclip } from 'lucide-react'

const CHANNELS  = ['Email', 'WhatsApp', 'Alibaba', 'Personal WhatsApp']
const STATUSES  = ['Open', 'Quoted', 'Confirmed', 'In Production', 'Completed', 'Lost', 'On Hold']

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
  // Quote file attachments (multiple)
  const [savedAttachments, setSavedAttachments]   = useState([])    // [{url, name, path}] from Firestore
  const [pendingFiles, setPendingFiles]           = useState([])    // File[] picked but not yet uploaded
  const [uploadProgress, setUploadProgress]       = useState({})    // { filename: 0-100 }
  const [removingIdx, setRemovingIdx]             = useState(null)
  const fileInputRef = useRef(null)

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
    // Support both old single attachment and new array
    if (enquiry.attachments?.length) {
      setSavedAttachments(enquiry.attachments)
    } else if (enquiry.attachment_url) {
      setSavedAttachments([{ url: enquiry.attachment_url, name: enquiry.attachment_name || 'attachment', path: enquiry.attachment_path || '' }])
    } else {
      setSavedAttachments([])
    }
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

  function uploadOneFile(file, enquiryId) {
    return new Promise((resolve, reject) => {
      const ext = file.name.split('.').pop()
      const path = `customers/${customerId}/enquiries/${enquiryId}/${Date.now()}_${file.name}`
      const ref = storageRef(storage, path)
      const task = uploadBytesResumable(ref, file)
      task.on('state_changed',
        snap => setUploadProgress(prev => ({ ...prev, [file.name]: Math.round(snap.bytesTransferred / snap.totalBytes * 100) })),
        reject,
        async () => {
          const url = await getDownloadURL(ref)
          resolve({ url, path, name: file.name })
        }
      )
    })
  }

  async function handleRemoveSaved(idx) {
    setRemovingIdx(idx)
    try {
      const att = savedAttachments[idx]
      if (att.path) { try { await deleteObject(storageRef(storage, att.path)) } catch {} }
      const updated = savedAttachments.filter((_, i) => i !== idx)
      if (isEdit) {
        await updateDoc(doc(db, 'customers', customerId, 'enquiries', enquiry.id), {
          attachments: updated, updatedAt: serverTimestamp(),
        })
      }
      setSavedAttachments(updated)
    } finally {
      setRemovingIdx(null)
    }
  }

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

      let enquiryId = enquiry?.id
      if (!isEdit) {
        const newRef = await addDoc(collection(db, 'customers', customerId, 'enquiries'), {
          ...payload, createdAt: serverTimestamp(),
        })
        enquiryId = newRef.id
      }

      // Upload any pending files
      const uploaded = pendingFiles.length
        ? await Promise.all(pendingFiles.map(f => uploadOneFile(f, enquiryId)))
        : []

      const allAttachments = [...savedAttachments, ...uploaded]

      if (isEdit) {
        await updateDoc(doc(db, 'customers', customerId, 'enquiries', enquiryId), {
          ...payload, attachments: allAttachments,
        })
      } else if (uploaded.length) {
        await updateDoc(doc(db, 'customers', customerId, 'enquiries', enquiryId), {
          attachments: allAttachments,
        })
      }

      onSave?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setUploadProgress({})
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
                  <button
                    type="button"
                    onClick={() => { toggleProduct(productSearch); setProductSearch('') }}
                    className="w-full text-left text-sm px-3 py-2 text-brand-600 hover:bg-brand-50 transition-colors"
                  >
                    + Add "{productSearch}" as custom item
                  </button>
                ) : (
                  <>
                    {filteredProducts.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { toggleProduct(p.name); setProductSearch('') }}
                        className={`w-full text-left text-sm px-3 py-2 hover:bg-gray-50 transition-colors ${selectedProducts.includes(p.name) ? 'text-brand-600 font-medium' : 'text-gray-700'}`}
                      >
                        {selectedProducts.includes(p.name) && <Check size={13} className="inline align-[-2px] mr-1" />}{p.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { toggleProduct(productSearch); setProductSearch('') }}
                      className="w-full text-left text-sm px-3 py-2 text-brand-400 hover:bg-brand-50 hover:text-brand-600 transition-colors italic"
                    >
                      + Add "{productSearch}" as custom item
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Follow-up date */}
          <div>
            <label className="label">Follow-up Date <span className="text-gray-400 font-normal">(optional)</span></label>
            <div className="flex items-center gap-2">
              <input type="date" className="input flex-1" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
              {followUpDate && (
                <button
                  type="button"
                  onClick={() => setFollowUpDate('')}
                  className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none shrink-0"
                  title="Clear date"
                >
                  ×
                </button>
              )}
            </div>
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

          {/* Quote file attachments */}
          <div>
            <label className="label">Quote Attachments <span className="text-gray-400 font-normal">(PDF or images)</span></label>

            <div className="space-y-2">
              {/* Saved attachments */}
              {savedAttachments.map((att, idx) => (
                <div key={idx} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
                  {att.name?.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? (
                    <a href={att.url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={att.url} alt="" className="h-10 w-14 object-cover rounded border border-gray-200" />
                    </a>
                  ) : (
                    <FileText size={20} className="text-gray-400 shrink-0" />
                  )}
                  <a href={att.url} target="_blank" rel="noreferrer" className="flex-1 text-sm text-brand-600 hover:underline truncate min-w-0">
                    {att.name || `Attachment ${idx + 1}`}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRemoveSaved(idx)}
                    disabled={removingIdx === idx}
                    className="text-xs text-red-400 hover:text-red-600 shrink-0"
                  >
                    {removingIdx === idx ? '…' : <X size={14} />}
                  </button>
                </div>
              ))}

              {/* Pending files (not yet uploaded) */}
              {pendingFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-3 p-2.5 rounded-lg border border-brand-200 bg-brand-50">
                  <span className="text-gray-500 shrink-0">{file.type.startsWith('image/') ? <ImageIcon size={18} /> : <FileText size={18} />}</span>
                  <span className="flex-1 text-sm text-brand-700 truncate min-w-0">{file.name}</span>
                  {uploadProgress[file.name] != null && (
                    <span className="text-xs text-brand-500 shrink-0">{uploadProgress[file.name]}%</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingFiles(f => f.filter((_, i) => i !== idx))}
                    className="text-xs text-red-400 hover:text-red-600 shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add more button — always visible */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 w-full border-2 border-dashed border-gray-200 rounded-lg py-3 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-500 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5"><Paperclip size={15} />Add PDF or image</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files)
                if (files.length) setPendingFiles(prev => [...prev, ...files])
                e.target.value = ''
              }}
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
  Open:           'border-amber-400 bg-amber-50 text-amber-700',
  Quoted:         'border-blue-400 bg-blue-50 text-blue-700',
  Confirmed:      'border-green-400 bg-green-50 text-green-700',
  'In Production':'border-purple-400 bg-purple-50 text-purple-700',
  Completed:      'border-teal-400 bg-teal-50 text-teal-700',
  Lost:           'border-red-400 bg-red-50 text-red-600',
  'On Hold':      'border-gray-400 bg-gray-100 text-gray-600',
}

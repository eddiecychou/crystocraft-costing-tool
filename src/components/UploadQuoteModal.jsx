import { useState, useEffect, useRef } from 'react'
import { collection, addDoc, updateDoc, doc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { CURRENCIES } from '../constants'
import { Image as ImageIcon, FileText, X, Paperclip } from 'lucide-react'

const todayISO = () => new Date().toISOString().split('T')[0]

export default function UploadQuoteModal({ onClose, onCreated }) {
  const [customers, setCustomers]         = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [form, setForm] = useState({
    client_name: '', quote_date: todayISO(), quote_currency: 'HKD',
    amount: '', status: 'sent', notes: '',
  })
  const [pendingFiles, setPendingFiles]   = useState([])
  const [uploadProgress, setUploadProgress] = useState({})
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    getDocs(query(collection(db, 'customers'), orderBy('company_name'))).then(snap =>
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
  }, [])

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  function handleCustomerSelect(e) {
    const cid = e.target.value
    setSelectedCustomerId(cid)
    if (!cid) return
    const c = customers.find(c => c.id === cid)
    if (c) setForm(f => ({ ...f, client_name: c.company_name || f.client_name }))
  }

  function uploadFile(file, quoteId) {
    return new Promise((resolve, reject) => {
      const path = `client_quotes/${quoteId}/${Date.now()}_${file.name}`
      const ref = storageRef(storage, path)
      const task = uploadBytesResumable(ref, file)
      task.on('state_changed',
        snap => setUploadProgress(prev => ({ ...prev, [file.name]: Math.round(snap.bytesTransferred / snap.totalBytes * 100) })),
        reject,
        async () => { resolve({ url: await getDownloadURL(ref), path, name: file.name }) }
      )
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.client_name.trim()) { setError('Client name is required.'); return }
    setLoading(true)
    setError('')
    try {
      const ref = await addDoc(collection(db, 'client_quotes'), {
        quote_type:   'uploaded',
        customer_id:  selectedCustomerId || null,
        client_name:  form.client_name.trim(),
        quote_date:   form.quote_date,
        quote_currency: form.quote_currency,
        amount:       form.amount ? Number(form.amount) : null,
        status:       form.status,
        notes:        form.notes.trim(),
        item_count:   0,
        attachments:  [],
        createdAt:    serverTimestamp(),
        updatedAt:    serverTimestamp(),
      })

      if (pendingFiles.length) {
        const uploaded = await Promise.all(pendingFiles.map(f => uploadFile(f, ref.id)))
        await updateDoc(doc(db, 'client_quotes', ref.id), { attachments: uploaded })
      }

      onCreated?.(ref.id)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-900">Upload Quote</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Customer */}
          <div>
            <label className="label">Customer</label>
            <select className="input" value={selectedCustomerId} onChange={handleCustomerSelect}>
              <option value="">— Select customer —</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}{c.contact_name ? ` · ${c.contact_name}` : ''}</option>
              ))}
            </select>
          </div>

          {/* Client name */}
          <div>
            <label className="label">Client Name *</label>
            <input className="input" value={form.client_name} onChange={set('client_name')} placeholder="e.g. Manulife HK" required />
          </div>

          {/* Date + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quote Date</label>
              <input className="input" type="date" value={form.quote_date} onChange={set('quote_date')} />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={form.quote_currency} onChange={set('quote_currency')}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Amount + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount <span className="text-gray-400 font-normal">(optional)</span></label>
              <input className="input" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} placeholder="e.g. 12000" />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={set('status')}>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="confirmed">Confirmed</option>
                <option value="lost">Lost</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Brief description of what was quoted…" />
          </div>

          {/* File attachments */}
          <div>
            <label className="label">Quote Files <span className="text-gray-400 font-normal">(PDF or images)</span></label>
            <div className="space-y-2">
              {pendingFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-3 p-2.5 rounded-lg border border-brand-200 bg-brand-50">
                  <span className="text-gray-500 shrink-0">{file.type.startsWith('image/') ? <ImageIcon size={18} /> : <FileText size={18} />}</span>
                  <span className="flex-1 text-sm text-brand-700 truncate min-w-0">{file.name}</span>
                  {uploadProgress[file.name] != null && (
                    <span className="text-xs text-brand-500 shrink-0">{uploadProgress[file.name]}%</span>
                  )}
                  <button type="button" onClick={() => setPendingFiles(f => f.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600 shrink-0"><X size={14} /></button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 w-full border-2 border-dashed border-gray-200 rounded-lg py-3 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-500 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5"><Paperclip size={15} />Add PDF or image</span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={e => { const files = Array.from(e.target.files); if (files.length) setPendingFiles(p => [...p, ...files]); e.target.value = '' }} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="submit" className="btn-primary flex-1" disabled={loading}>
              {loading ? 'Saving…' : 'Save Quote'}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

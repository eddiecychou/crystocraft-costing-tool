import { useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'
import { Gem, Package, Trash2, ClipboardList, CheckCircle2 } from 'lucide-react'
import { useCart } from './store'

export default function EnquiryPage({ profile }) {
  const cart = useCart()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const items = cart?.items || []

  async function submit() {
    if (!items.length) return
    setSending(true); setError('')
    try {
      await addDoc(collection(db, 'enquiries'), {
        uid: auth.currentUser?.uid || profile?.id || null,
        company_name: profile?.company_name || '',
        contact_name: profile?.contact_name || '',
        email: profile?.email || auth.currentUser?.email || '',
        base_currency: profile?.base_currency || '',
        items: items.map(i => ({
          type: i.type, id: i.id, name: i.name || '', code: i.code || '',
          image: i.image || '', qty: Number(i.qty) || 1, note: i.note || '',
        })),
        message,
        status: 'new',
        createdAt: serverTimestamp(),
      })
      cart.clear()
      setSent(true)
    } catch {
      setError('Could not send your enquiry. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center py-20">
        <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
        <h1 className="text-xl text-ink mb-1">Enquiry sent</h1>
        <p className="text-sm text-ink-60 mb-6">Thank you — our team will get back to you by email shortly.</p>
        <Link to="/shop/figurine" className="btn-primary">Continue browsing</Link>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="text-center py-20 text-ink-60">
        <ClipboardList size={32} className="mx-auto text-ink-30 mb-3" />
        <p>Your enquiry list is empty.</p>
        <p className="text-sm text-ink-50 mt-1">Add products from the catalogue to request a quotation.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl md:text-2xl mb-1">Enquiry <span className="text-ink-50 text-base">({items.length})</span></h1>
      <p className="text-sm text-ink-60 mb-5">Review your selection, add quantities and notes, then send us a request for quotation.</p>

      <div className="card divide-y divide-ivory-dark mb-5">
        {items.map(i => {
          const Icon = i.type === 'figurine' ? Gem : Package
          return (
            <div key={`${i.type}-${i.id}`} className="flex items-center gap-3 p-3">
              <div className="w-14 h-14 bg-white border border-ivory-dark rounded flex items-center justify-center overflow-hidden shrink-0">
                {i.image ? <img src={i.image} alt={i.name} className="w-full h-full object-contain" />
                  : <Icon size={20} className="text-gray-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{i.name}</p>
                {i.code && <p className="text-[11px] text-ink-50 font-mono">{i.code}</p>}
                <input type="text" placeholder="Note (colour, plating, customisation…)"
                  value={i.note || ''} onChange={e => cart.update(i.type, i.id, { note: e.target.value })}
                  className="input py-1 text-xs mt-1 w-full" />
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <label className="text-[11px] text-ink-50">Qty
                  <input type="number" min="1" value={i.qty || 1}
                    onChange={e => cart.update(i.type, i.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                    className="input py-1 w-20 ml-1 inline-block" />
                </label>
                <button onClick={() => cart.remove(i.type, i.id)} className="text-ink-40 hover:text-red-500" aria-label="Remove">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <label className="label">Message (optional)</label>
      <textarea className="input min-h-[90px]" placeholder="Tell us about quantities, deadlines, branding or any questions…"
        value={message} onChange={e => setMessage(e.target.value)} />

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      <div className="flex items-center gap-3 mt-4">
        <button onClick={submit} disabled={sending} className="btn-primary">
          {sending ? 'Sending…' : 'Send enquiry'}
        </button>
        <button onClick={() => cart.clear()} className="text-sm text-ink-50 hover:text-ink">Clear list</button>
      </div>
      <p className="text-[11px] text-ink-40 mt-3">
        This sends a request for quotation to Crystocraft using your account details
        ({profile?.company_name || profile?.email}). No payment is taken.
      </p>
    </div>
  )
}

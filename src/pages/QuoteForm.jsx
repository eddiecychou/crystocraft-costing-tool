import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { CURRENCIES } from '../constants'

const DEFAULT_RATES = { rmb_to_hkd: 1.09, usd_to_hkd: 7.78, eur_to_hkd: 8.60 }

export default function QuoteForm() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    client_name: '', contact_name: '', contact_email: '',
    contact_phone: '', notes: '', status: 'draft',
    quote_currency: 'HKD',
    rmb_to_hkd: DEFAULT_RATES.rmb_to_hkd,
    usd_to_hkd: DEFAULT_RATES.usd_to_hkd,
    eur_to_hkd: DEFAULT_RATES.eur_to_hkd,
  })

  useEffect(() => {
    getDoc(doc(db, 'settings', 'exchange_rates')).then(s => {
      if (s.exists()) {
        const d = s.data()
        setForm(f => ({
          ...f,
          rmb_to_hkd: d.RMB ?? f.rmb_to_hkd,
          usd_to_hkd: d.USD ?? f.usd_to_hkd,
          eur_to_hkd: d.EUR ?? f.eur_to_hkd,
        }))
      }
    })
  }, [])
  const [loading, setLoading] = useState(false)

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const ref = await addDoc(collection(db, 'client_quotes'), {
        ...form,
        rmb_to_hkd: Number(form.rmb_to_hkd),
        usd_to_hkd: Number(form.usd_to_hkd),
        eur_to_hkd: Number(form.eur_to_hkd),
        item_count: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      navigate(`/quotes/${ref.id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-xl">
      <div className="mb-6">
        <Link to="/quotes" className="text-sm text-brand-600 hover:underline">← Quotes</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">New Client Quote</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card p-6 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Client Details</p>

          <div>
            <label className="label">Company / Client Name *</label>
            <input className="input" value={form.client_name} onChange={set('client_name')} required placeholder="e.g. Manulife HK" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Contact Name</label>
              <input className="input" value={form.contact_name} onChange={set('contact_name')} placeholder="e.g. Sarah Chan" />
            </div>
            <div>
              <label className="label">Contact Email</label>
              <input className="input" type="email" value={form.contact_email} onChange={set('contact_email')} />
            </div>
          </div>
          <div>
            <label className="label">Contact Phone</label>
            <input className="input" value={form.contact_phone} onChange={set('contact_phone')} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Brief requirements, occasion, deadline…" />
          </div>
        </div>

        <div className="card p-6 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quote Currency & Exchange Rates</p>
          <div>
            <label className="label">Quote Currency</label>
            <select className="input w-40" value={form.quote_currency} onChange={set('quote_currency')}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">All prices in this quote will be shown in this currency.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">RMB → HKD</label>
              <input className="input" type="number" step="0.01" value={form.rmb_to_hkd} onChange={set('rmb_to_hkd')} />
            </div>
            <div>
              <label className="label">USD → HKD</label>
              <input className="input" type="number" step="0.01" value={form.usd_to_hkd} onChange={set('usd_to_hkd')} />
            </div>
            <div>
              <label className="label">EUR → HKD</label>
              <input className="input" type="number" step="0.01" value={form.eur_to_hkd} onChange={set('eur_to_hkd')} />
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Creating…' : 'Create Quote'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

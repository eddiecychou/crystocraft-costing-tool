import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { CURRENCIES } from '../constants'
import { loadCustomers, primaryContact, contactAddress } from '../domain/customer'
import ContactPicker from '../components/ContactPicker'

const DEFAULT_RATES = { rmb_to_hkd: 1.09, usd_to_hkd: 7.78, eur_to_hkd: 8.60 }

export default function QuoteForm() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [customers, setCustomers] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState(searchParams.get('customer_id') || '')

  const todayISO = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState({
    client_name: '', contact_id: '', contact_name: '', contact_email: '',
    contact_phone: '', contact_address: '', notes: '', status: 'draft',
    quote_currency: 'HKD',
    quote_date: todayISO,
    rmb_to_hkd: DEFAULT_RATES.rmb_to_hkd,
    usd_to_hkd: DEFAULT_RATES.usd_to_hkd,
    eur_to_hkd: DEFAULT_RATES.eur_to_hkd,
  })
  const [loading, setLoading] = useState(false)

  // Load customers list + exchange rates
  useEffect(() => {
    loadCustomers().then(setCustomers)
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

  // Pre-fill from customer_id in URL
  useEffect(() => {
    if (!selectedCustomerId) return
    const c = customers.find(c => c.id === selectedCustomerId)
    if (c) prefillFromCustomer(c)
  }, [selectedCustomerId, customers])

  // c comes from loadCustomers() — the canonical customer shape carries a
  // contacts[] list of real, separate people (domain/customer.js), not one
  // shared contact_name + un-attributed emails. Defaults to whichever contact
  // is flagged Primary; the ContactPicker below lets the admin pick a
  // different one when the customer has several.
  function prefillFromCustomer(c) {
    const contact = primaryContact(c.contacts)
    setForm(f => ({
      ...f,
      client_name: c.company_name || f.client_name,
      contact_id: contact?.id || '',
      contact_name: contact?.name || f.contact_name,
      contact_email: contact?.email || f.contact_email,
      contact_phone: contact?.phone || f.contact_phone,
      contact_address: contactAddress(contact, c) || f.contact_address,
    }))
  }

  function handleCustomerSelect(e) {
    const cid = e.target.value
    setSelectedCustomerId(cid)
    if (!cid) return
    const c = customers.find(c => c.id === cid)
    if (c) prefillFromCustomer(c)
  }

  // Switching the ContactPicker away from the auto-selected Primary — re-fill
  // name/email/phone/address from whichever contact was picked instead.
  function handleContactChange(contactId) {
    const c = customers.find(x => x.id === selectedCustomerId)
    const contact = (c?.contacts || []).find(x => x.id === contactId) || null
    setForm(f => ({
      ...f,
      contact_id: contactId || '',
      contact_name: contact?.name || '',
      contact_email: contact?.email || '',
      contact_phone: contact?.phone || '',
      contact_address: contactAddress(contact, c) || '',
    }))
  }

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const ref = await addDoc(collection(db, 'client_quotes'), {
        ...form,
        customer_id: selectedCustomerId || null,
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
        <h1 className="text-2xl font-bold text-ink mt-1">New Client Quote</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Customer picker */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Client</p>
          <div>
            <label className="label">Select Existing Customer</label>
            <select className="input" value={selectedCustomerId} onChange={handleCustomerSelect}>
              <option value="">— Enter manually below —</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.company_name}{c.contact_name ? ` · ${c.contact_name}` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-60 mt-1">
              Selecting a customer pre-fills the fields below.{' '}
              <Link to="/customers/new" className="text-brand-500 hover:underline" target="_blank">+ Add new customer</Link>
            </p>
          </div>
          {selectedCustomerId && (
            <ContactPicker customerId={selectedCustomerId} value={form.contact_id} onChange={handleContactChange}
                           label="Addressed to" />
          )}
        </div>

        {/* Client details */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Client Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Company / Client Name *</label>
              <input className="input" value={form.client_name} onChange={set('client_name')} required placeholder="e.g. Manulife HK" />
            </div>
            <div>
              <label className="label">Quote Date</label>
              <input className="input" type="date" value={form.quote_date} onChange={set('quote_date')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Contact Name</label>
              <input className="input" value={form.contact_name} onChange={set('contact_name')} placeholder="e.g. Sarah Chan" />
            </div>
            <div>
              <label className="label">Contact Email</label>
              <input className="input" type="email" value={form.contact_email} onChange={set('contact_email')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Contact Phone</label>
              <input className="input" value={form.contact_phone} onChange={set('contact_phone')} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={form.contact_address} onChange={set('contact_address')} placeholder="e.g. 123 Main St, Hong Kong" />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Brief requirements, occasion, deadline…" />
          </div>
        </div>

        {/* Currency & rates */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Quote Currency & Exchange Rates</p>
          <div>
            <label className="label">Quote Currency</label>
            <select className="input w-40" value={form.quote_currency} onChange={set('quote_currency')}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <p className="text-xs text-ink-60 mt-1">All prices in this quote will be shown in this currency.</p>
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

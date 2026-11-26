import { ocDateOnly } from '../ocTime.js'
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { CURRENCIES } from '../constants'
import { loadCustomers, primaryContact, contactAddress, CRM_CATEGORIES, RETAIL_TAG } from '../domain/customer'
import ContactPicker from '../components/ContactPicker'
import { DEFAULT_RATES } from '../domain/customerCurrency.js'
import { isPositiveExchangeRate } from '../costCurrency.js'
import useConfiguredExchangeRates from '../hooks/useConfiguredExchangeRates'

const RATE_FIELDS = [['RMB', 'rmb_to_hkd'], ['USD', 'usd_to_hkd'], ['EUR', 'eur_to_hkd']]

export default function QuoteForm() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [customers, setCustomers] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState(searchParams.get('customer_id') || '')
  const [customerGroup, setCustomerGroup] = useState('b2b')
  const [customerSearch, setCustomerSearch] = useState('')

  const todayISO = ocDateOnly(new Date())

  const [form, setForm] = useState({
    client_name: '', contact_id: '', contact_name: '', contact_email: '',
    contact_phone: '', contact_address: '', notes: '', status: 'draft',
    quote_currency: 'HKD',
    quote_date: todayISO,
  })
  const [loading, setLoading] = useState(false)
  const [editedRates, setEditedRates] = useState({})
  const { status: rateStatus, rates: settingsRates, retry: retryRates } = useConfiguredExchangeRates()

  useEffect(() => {
    loadCustomers().then(setCustomers)
  }, [])

  // An edited field, including one deliberately cleared, takes precedence over Settings.
  const rateValues = Object.fromEntries(RATE_FIELDS.map(([currency, field]) =>
    [field, editedRates[field] ?? settingsRates[currency] ?? '']
  ))
  const quoteRates = Object.fromEntries(RATE_FIELDS.map(([, field]) => [field, Number(rateValues[field])]))
  const invalidRates = RATE_FIELDS.filter(([, field]) => !isPositiveExchangeRate(quoteRates[field]))
  const ratesToReview = invalidRates.filter(([currency]) => settingsRates[currency] == null)
  const reviewCurrencies = ratesToReview.map(([currency]) => currency).join(', ')
  let rateMessage = ''
  if (rateStatus === 'loading') {
    rateMessage = 'Loading exchange rates from Settings…'
  } else if (ratesToReview.length) {
    const settingsIssue = rateStatus === 'error' ? 'Could not load exchange rates from Settings.' : 'Settings has missing or invalid rates.'
    rateMessage = `${settingsIssue} Enter a positive rate for ${reviewCurrencies} or use the suggested values.`
  } else if (invalidRates.length) {
    rateMessage = `Enter a positive rate for ${invalidRates.map(([currency]) => currency).join(', ')}.`
  }

  function applySuggestedRates() {
    const suggested = Object.fromEntries(ratesToReview.map(([currency, field]) => [field, DEFAULT_RATES[currency]]))
    setEditedRates(rates => ({ ...rates, ...suggested }))
  }

  // Pre-fill from customer_id in URL
  useEffect(() => {
    if (!selectedCustomerId) return
    const c = customers.find(c => c.id === selectedCustomerId)
    if (c) {
      if (!CRM_CATEGORIES.includes(c.crm_category) && c.tags?.includes(RETAIL_TAG)) setCustomerGroup('b2c')
      else if (!CRM_CATEGORIES.includes(c.crm_category)) setCustomerGroup('all')
      prefillFromCustomer(c)
    }
  }, [selectedCustomerId, customers])

  const groupCounts = {
    b2b: customers.filter(c => CRM_CATEGORIES.includes(c.crm_category)).length,
    b2c: customers.filter(c => c.tags?.includes(RETAIL_TAG)).length,
    all: customers.length,
  }
  const searchTerm = customerSearch.trim().toLocaleLowerCase()
  const visibleCustomers = customers.filter(c => {
    const inGroup = customerGroup === 'all' || (customerGroup === 'b2c'
      ? c.tags?.includes(RETAIL_TAG) : CRM_CATEGORIES.includes(c.crm_category))
    if (!inGroup) return false
    return !searchTerm || [c.company_name, c.contact_name, c.erp_code,
      ...(c.contacts || []).map(contact => contact.name)]
      .some(value => String(value || '').toLocaleLowerCase().includes(searchTerm))
  })
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

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
    if (loading || invalidRates.length) return
    setLoading(true)
    try {
      const ref = await addDoc(collection(db, 'client_quotes'), {
        ...form,
        customer_id: selectedCustomerId || null,
        ...quoteRates,
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
        <h1 className="text-2xl text-ink mt-1">New Client Quote</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Customer picker */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-ink-60 uppercase tracking-wide">Client</p>
          <div>
            <label className="label" htmlFor="quote-customer">Select Existing Customer</label>
            <div className="flex flex-wrap gap-2 mt-2 mb-3" role="group" aria-label="Customer type">
              {[
                { key: 'b2b', label: 'B2B' },
                { key: 'b2c', label: 'B2C' },
                { key: 'all', label: 'All' },
              ].map(group => (
                <button key={group.key} type="button" aria-pressed={customerGroup === group.key}
                  onClick={() => { setCustomerGroup(group.key); setCustomerSearch('') }}
                  className={`px-3 py-2 rounded-full text-sm border transition-colors focus-visible:ring-2 focus-visible:ring-brand-600 ${customerGroup === group.key
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-ink-70 border-warm-grey hover:bg-ivory-dark'}`}>
                  {group.label} <span className={customerGroup === group.key ? 'text-white/70' : 'text-ink-60'}>{groupCounts[group.key]}</span>
                </button>
              ))}
            </div>
            <input className="input mb-2" type="search" value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              placeholder={`Search ${customerGroup === 'all' ? 'all customers' : customerGroup.toUpperCase() + ' customers'}…`}
              aria-label="Search customers" />
            <select id="quote-customer" className="input" value={selectedCustomerId} onChange={handleCustomerSelect}>
              <option value="">— Enter manually below —</option>
              {selectedCustomer && !visibleCustomers.some(c => c.id === selectedCustomerId) && (
                <option value={selectedCustomerId}>{selectedCustomer.company_name} · current selection</option>
              )}
              {visibleCustomers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.company_name}{c.contact_name ? ` · ${c.contact_name}` : ''}
                </option>
              ))}
            </select>
            {visibleCustomers.length === 0 && customers.length > 0 && (
              <p className="text-xs text-ink-60 mt-1">No customers in this view match your search. Try All or a different name.</p>
            )}
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
              <label className="label" htmlFor="quote-client-name">Company / Client Name *</label>
              <input id="quote-client-name" className="input" value={form.client_name} onChange={set('client_name')} required placeholder="e.g. Manulife HK" />
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
            {RATE_FIELDS.map(([currency, field]) => (
              <div key={currency}>
                <label className="label" htmlFor={`quote-${field}`}>{currency} → HKD</label>
                <input id={`quote-${field}`} className="input" type="number" step="any" required
                  aria-describedby={rateMessage ? 'quote-rate-status' : undefined}
                  value={rateValues[field]}
                  placeholder={rateStatus !== 'loading' && settingsRates[currency] == null ? String(DEFAULT_RATES[currency]) : undefined}
                  onChange={e => {
                    const value = e.target.value
                    setEditedRates(rates => ({ ...rates, [field]: value }))
                  }} />
              </div>
            ))}
          </div>
          <div role="status" id="quote-rate-status" className="text-xs text-ink-60">{rateMessage}</div>
          {rateStatus !== 'loading' && ratesToReview.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={applySuggestedRates}>Use suggested rates</button>
              <button type="button" className="btn-secondary text-xs" onClick={retryRates}>Retry rates</button>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={loading || invalidRates.length > 0}>{loading ? 'Creating…' : 'Create Quote'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

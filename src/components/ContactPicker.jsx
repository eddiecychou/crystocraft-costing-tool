import { useState, useEffect } from 'react'
import { getCustomer } from '../domain/customer'

// Shared "which contact" dropdown. Quotes, PI/Orders, the Interaction Log, and
// portal-account linking all pick from the SAME customer.contacts list, so
// this is the one place that loads and renders it — a customer with several
// real contacts (owner, 2026-08-05) needs every one of those surfaces to be
// able to say WHICH person a document/interaction/login is with.
export default function ContactPicker({ customerId, value, onChange, allowNone = true, label = 'Contact', className = '' }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!customerId) { setContacts([]); return }
    setLoading(true)
    getCustomer(customerId).then(c => setContacts(c?.contacts || [])).finally(() => setLoading(false))
  }, [customerId])

  if (!customerId) return null

  return (
    <div className={className}>
      {label && <label className="label text-xs">{label}</label>}
      <select className="input text-sm" value={value || ''} onChange={e => onChange(e.target.value || null)} disabled={loading}>
        {allowNone && (
          <option value="">{loading ? 'Loading…' : (contacts.length ? '— none selected —' : 'No contacts on file')}</option>
        )}
        {contacts.map(c => (
          <option key={c.id} value={c.id}>
            {c.name || '(no name)'}{c.is_primary ? ' ★' : ''}{c.email ? ` — ${c.email}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

import ContactPicker from '../ContactPicker'

export default function ShipmentCustomerCard({
  customers, customerId, customerName, contactId, addingCustomer,
  onCustomer, onContactChange, onAddCustomer,
}) {
  return (
    <div className="card p-4 md:p-6 space-y-3">
      <h2 className="text-xs text-ink-60 uppercase tracking-wide">Customer</h2>
      <div>
        <label className="label">Customer</label>
        <select className="input" value={customers.find(c => c.id === customerId) ? customerId : ''} onChange={onCustomer}>
          <option value="">— select customer —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.erp_code ? `[${c.erp_code}] ` : ''}{c.company_name}</option>)}
        </select>
        {!customerId && customerName && (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <p className="text-xs text-amber-600">From PI: "{customerName}" — not linked to any customer.</p>
            <button type="button" onClick={onAddCustomer} disabled={addingCustomer}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline disabled:opacity-50">
              {addingCustomer ? 'Adding…' : '+ Add as new customer'}
            </button>
          </div>
        )}
        {customerId && (
          <ContactPicker customerId={customerId} value={contactId}
                         onChange={onContactChange}
                         label="Addressed to" className="mt-2" />
        )}
      </div>
    </div>
  )
}

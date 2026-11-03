import { INCOTERMS, PAYMENT_TERMS, ORDER_CURRENCIES, ORDER_STATUSES } from '../../shipping'
import { ShipmentStockStatusBadge } from './ShipmentReconciliation'

export default function ShipmentScheduleTerms({ header, setH, isEdit, setStatus, stock }) {
  return (
    <div className="card p-4 md:p-6 space-y-3">
      <h2 className="text-xs text-ink-60 uppercase tracking-wide">Schedule &amp; Terms</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className="label">Order Date</label>
          <input className="input" type="date" value={header.order_date} onChange={setH('order_date')} />
        </div>
        <div>
          <label className="label">Est. Ship Date</label>
          <input className="input" type="date" value={header.est_ship_date} onChange={setH('est_ship_date')} />
        </div>
        {header.erp_si_no && (
          <div>
            <label className="label" title="The accounting date printed on the invoice and used in financial reports. Blank falls back to the date the invoice number was allocated.">Invoice Date</label>
            <input className="input" type="date" value={header.invoice_date} onChange={setH('invoice_date')} placeholder={header.invoiced_at} />
          </div>
        )}
        <div>
          <label className="label">Currency</label>
          <select className="input" value={header.currency} onChange={setH('currency')}>{ORDER_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
        </div>
        <div>
          <label className="label">Incoterm</label>
          <select className="input" value={header.incoterm} onChange={setH('incoterm')}>{INCOTERMS.map(t => <option key={t}>{t}</option>)}</select>
        </div>
        <div>
          <label className="label">Payment Terms</label>
          {/* Free text with common presets — terms are negotiated per
              customer, and this prints on the PI and the invoice. */}
          <input className="input" list="payment-terms" value={header.payment_terms}
                 onChange={setH('payment_terms')} placeholder="e.g. Full Payment Before Shipment" />
          <datalist id="payment-terms">
            {PAYMENT_TERMS.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>
        {isEdit && (
          <div>
            <label className="label">Status</label>
            <select className="input" value={header.status} onChange={setStatus}>{ORDER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            {stock && (
              <ShipmentStockStatusBadge stock={stock} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

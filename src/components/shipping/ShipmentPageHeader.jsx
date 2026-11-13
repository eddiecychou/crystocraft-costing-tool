import { Link } from 'react-router-dom'
import { FileText, Receipt } from 'lucide-react'

// Controlled page chrome only. State, allocation, saving and tab content remain
// in ShipmentForm; rendering this component never reads or writes business data.
export default function ShipmentPageHeader({
  id, isEdit, isDirect, invoiceNo, ucNo, allocatingSi, saving, siError,
  onRaiseInvoice, tab, onTabChange, fromQuote = false, closed = false,
}) {
  return (
    <>
      <div className="mb-4">
        <Link to="/shipments" className="text-sm text-brand-600 hover:underline">← Order Listing</Link>
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3 mt-1">
          <h1 className="text-2xl text-ink">
            {isEdit
              ? (invoiceNo || ucNo || 'Order Detail')
              : (fromQuote ? 'Quote orders' : isDirect ? 'Direct Invoice' : 'New Order')}
          </h1>
          {isEdit && (
            <div className="shrink-0 w-full sm:w-auto text-right">
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <a href={`/shipments/${id}/pi`} target="_blank" rel="noreferrer"
                   className="btn-secondary text-sm inline-flex items-center gap-1.5">
                  <FileText size={14} /> Proforma Invoice
                </a>
                {/* Convert the order/PI into a sales invoice in one click: allocate
                    its SI number (and a UC if it has none). Previously this was
                    only reachable via a subtle "Allocate" link far down the form,
                    so "generate an invoice from an SO" looked impossible. Once
                    invoiced, this becomes a link to the printed invoice. */}
                {invoiceNo ? (
                  <a href={`/shipments/${id}/invoice`} target="_blank" rel="noreferrer"
                     className="btn-primary text-sm inline-flex items-center gap-1.5">
                    <Receipt size={14} /> Invoice {invoiceNo}
                  </a>
                ) : !closed && (
                  <button type="button" onClick={onRaiseInvoice} disabled={allocatingSi || saving}
                    className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                    title="Allocate this order's invoice number (SI) and UC — turns the proforma into a sales invoice.">
                    <Receipt size={14} /> {allocatingSi ? 'Raising…' : 'Raise Invoice'}
                  </button>
                )}
              </div>
              {siError && <p className="text-xs text-red-600 mt-1">{siError}</p>}
            </div>
          )}
        </div>
        {!isEdit && (
          <p className="text-sm text-ink-60 mt-1">
            {fromQuote
              ? 'Open an existing order, resume a saved conversion, or review a new order from this quote.'
              : isDirect
              ? 'A retail sale invoiced directly — no sales order needed. Add the lines, then allocate an invoice number.'
              : 'Enter the order directly, or drop a PI below to have AI read the header and line items.'}
          </p>
        )}
      </div>

      {/* Tabs — only shown on edit (saved order) */}
      {isEdit && (
        <div className="flex gap-0 border-b border-warm-grey mb-5">
          {[
            { v: 'order',   label: 'Order & Lines' },
            { v: 'packing', label: 'Packing List' },
            { v: 'freight', label: 'Freight' },
          ].map(t => (
            <button
              key={t.v}
              type="button"
              onClick={() => onTabChange(t.v)}
              disabled={saving}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
 tab === t.v
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-ink-60 hover:text-ink-80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

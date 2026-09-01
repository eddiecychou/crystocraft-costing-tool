import { useState, useEffect } from 'react'
import { erpLines } from '../erpApi'
import { X, Database } from 'lucide-react'

// Read-only detail for a document that lives in JES, not the app — a sales
// order or a sales invoice from the ERP mirror.
//
// Read-only is not the same as opaque: these rows appear in the app's own lists,
// so being unable to see what is on them made the history look like decoration.
// Nothing here is editable, because the app cannot amend a document JES
// produced, but everything is visible.
//
// `of` is 'sales_order' or 'sales_invoice' — the same values erpLines takes.

const fmtQty = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : (v ?? '—')
}
const fmtMoney = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
}
const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ErpDocModal({ of, doc, onClose }) {
  const [lines, setLines] = useState([])
  const [surcharges, setSurcharges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const code = (doc?.code || '').trim()

  useEffect(() => {
    if (!code) return
    let alive = true
    setLoading(true); setError('')
    erpLines(of, code)
      .then((r) => { if (alive) { setLines(r.rows || []); setSurcharges(r.surcharges || []) } })
      .catch((e) => { if (alive) setError(e.message || 'Could not load the document lines.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [of, code])

  // Escape closes — this is a read-only viewer, so there is nothing to lose.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!doc) return null

  const isInvoice = of === 'sales_invoice'
  const lineSum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8 overflow-y-auto"
         onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl my-auto" onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ivory-dark">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 font-mono">{code}</h2>
              <span className="text-[10px] font-medium text-ink-60 inline-flex items-center gap-1 border border-ivory-dark rounded-full px-2 py-0.5">
                <Database size={10} /> JES · read-only
              </span>
              {(doc.status || '').trim().toUpperCase() === 'VOID' && (
                <span className="text-[10px] font-medium text-red-600 border border-red-200 bg-red-50 rounded-full px-2 py-0.5">VOID</span>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-1 truncate">{doc.customer || '—'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm border-b border-ivory-dark bg-ivory/40">
          <Field label="Date" value={fmtDate(doc.date)} />
          <Field label="Currency" value={doc.currency || '—'} />
          <Field label="UC#" value={(doc.ref || '').trim() || '—'} mono />
          <Field label={isInvoice ? 'Status' : 'Status'} value={(doc.status || '').trim() || '—'} />
          {doc.customer_po && <Field label="Customer PO" value={doc.customer_po} mono />}
          {doc.customer_code && <Field label="Customer Code" value={doc.customer_code} mono />}
          {doc.salesperson && <Field label="Salesperson" value={doc.salesperson} />}
          {doc.payment_terms && <Field label="Terms" value={doc.payment_terms} />}
        </div>

        <div className="px-5 py-4">
          {loading && <p className="text-sm text-gray-400 py-6 text-center">Loading lines…</p>}
          {error && <p className="text-sm text-red-600 py-4">{error}</p>}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium whitespace-nowrap">Item Code</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Qty</th>
                    <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Unit Price</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3 text-gray-400">{l.seq ?? i + 1}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-700 whitespace-nowrap">{(l.item_code || '').trim() || '—'}</td>
                      {/* JES descriptions carry real newlines (the MISC lines
                          especially) — preserve them rather than running the
                          text together. */}
                      <td className="py-2 pr-3 text-gray-700 whitespace-pre-wrap">{(l.description || '').trim() || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-700 whitespace-nowrap">{fmtQty(l.qty)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-600 whitespace-nowrap">{fmtMoney(l.unit_price)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-800 whitespace-nowrap">{fmtMoney(l.amount)}</td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-gray-400">No lines recorded on this document.</td></tr>
                  )}
                </tbody>
              </table>

              {/* Surcharges live in separate tables in JES (freight, packing,
                  card charges) — V7.14 found the header does not reconcile
                  without them, so they are shown rather than quietly dropped. */}
              {surcharges.length > 0 && (
                <table className="w-full text-sm mt-3 border-t border-gray-100 pt-2">
                  <tbody className="divide-y divide-gray-50">
                    {surcharges.map((sc, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-3 text-gray-500">
                          {(sc.description || '').trim() || (sc.code || '').trim() || 'Surcharge'}
                          {sc.description && sc.code && (
                            <span className="ml-1.5 font-mono text-[10px] text-gray-400">{(sc.code || '').trim()}</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-700">{fmtMoney(sc.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="flex justify-end gap-6 mt-4 pt-3 border-t border-gray-200 text-sm">
                <span className="text-gray-500">Line total</span>
                <span className="font-mono tabular-nums text-gray-700">{fmtMoney(lineSum)}</span>
                <span className="text-gray-500">Document total</span>
                <span className="font-mono tabular-nums font-semibold text-gray-900">
                  {doc.currency} {fmtMoney(doc.amount)}
                </span>
              </div>
              {/* The two disagreeing is normal, not a bug: the header total
                  includes discount, surcharges and tax. Saying so avoids someone
                  reporting it as one. */}
              {Math.abs(lineSum - (Number(doc.amount) || 0)) > 0.02 && (
                <p className="text-xs text-gray-400 text-right mt-1">
                  Lines and document total differ — the header also carries discount, surcharges and tax.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-gray-800 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  )
}

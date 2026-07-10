import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { doc, getDoc, deleteDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import LoadingBar from '../components/LoadingBar'
import ConfirmDialog from '../components/ConfirmDialog'
import { PO_STATUSES, PO_PAYMENT_TERM_LABEL, amountInWords } from '../constants'
import { fmtMoney } from '../currency'
import { poTotals, lineAmount } from '../purchaseOrders'
import { Printer, Copy, MoreHorizontal, Trash2, RefreshCw } from 'lucide-react'

const STATUS_META = Object.fromEntries(PO_STATUSES.map(s => [s.value, s]))

function fmtDate(s) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function InfoRow({ label, value }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="text-xs text-gray-500 w-32 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800">{value || '—'}</span>
    </div>
  )
}

export default function PurchaseOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [po, setPo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'purchase_orders', id)).then(snap => {
      if (snap.exists()) setPo({ id: snap.id, ...snap.data() })
      setLoading(false)
    }).catch(() => setLoading(false))   // don't hang the spinner on a failed read
  }, [id])

  async function handleDelete() {
    await deleteDoc(doc(db, 'purchase_orders', id))
    navigate('/purchase-orders')
  }

  async function toggleStatus() {
    const next = (po.status || 'draft') === 'issued' ? 'draft' : 'issued'
    await updateDoc(doc(db, 'purchase_orders', id), { status: next, updatedAt: serverTimestamp() })
    setPo(p => ({ ...p, status: next }))
  }

  if (loading) return <LoadingBar />
  if (!po) return <div className="p-6 text-gray-500">Purchase order not found.</div>

  const meta = STATUS_META[po.status || 'draft'] || STATUS_META.draft
  const totals = poTotals(po)
  const cur = po.currency || 'RMB'
  const termsLabel = [PO_PAYMENT_TERM_LABEL[po.payment_terms], po.payment_terms_custom].filter(Boolean).join(' · ')

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <Link to="/purchase-orders" className="text-sm text-brand-600 hover:underline">← Purchase Orders</Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mt-2 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 font-mono">{po.pu_number || '(no PU no.)'}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">
            {po.supplier_name}{po.supplier_name_cn ? ` · ${po.supplier_name_cn}` : ''}
            {po.supplier_erp_code ? ` · ${po.supplier_erp_code}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link to={`/purchase-orders/${id}/edit`} className="btn-primary">Edit</Link>
          <a href={`/purchase-orders/${id}/print`} target="_blank" rel="noreferrer"
             className="btn-secondary inline-flex items-center gap-1.5"><Printer size={15} />Print</a>

          {/* Overflow menu — less-frequent actions */}
          <div className="relative">
            <button onClick={() => setMenuOpen(o => !o)} aria-label="More actions"
                    className="btn-secondary px-2.5"><MoreHorizontal size={18} /></button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-48 bg-white border border-gray-200 rounded-md shadow-lg py-1">
                  <Link to={`/purchase-orders/new?from=${id}`} onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <Copy size={15} className="text-gray-400" />Duplicate / reorder
                  </Link>
                  <button onClick={() => { setMenuOpen(false); toggleStatus() }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <RefreshCw size={15} className="text-gray-400" />
                    {(po.status || 'draft') === 'issued' ? 'Mark as Draft' : 'Mark as Issued'}
                  </button>
                  <div className="my-1 border-t border-gray-100" />
                  <button onClick={() => { setMenuOpen(false); setConfirmDelete(true) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                    <Trash2 size={15} />Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Header details */}
      <div className="card p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
        <div>
          <InfoRow label="Issued Date" value={fmtDate(po.issued_date)} />
          <InfoRow label="Est. Ship Date" value={fmtDate(po.est_ship_date)} />
          <InfoRow label="Ship To" value={po.ship_to} />
        </div>
        <div>
          <InfoRow label="Currency" value={cur} />
          <InfoRow label="Payment Terms" value={termsLabel} />
          <InfoRow label="Deposit" value={po.deposit_pct ? `${po.deposit_pct}%` : '—'} />
        </div>
      </div>

      {/* Lines */}
      <div className="card overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2 font-medium">Item Code</th>
              <th className="px-2 py-2 font-medium">Description</th>
              <th className="px-2 py-2 font-medium text-right">Qty</th>
              <th className="px-2 py-2 font-medium text-right">Unit Price</th>
              <th className="px-4 py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(po.lines || []).map((ln, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-mono text-xs text-gray-700 align-top">{ln.code || '—'}</td>
                <td className="px-2 py-2 text-gray-700 align-top">{ln.description || '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums align-top">{Number(ln.qty).toLocaleString()} {ln.unit || 'pcs'}</td>
                <td className="px-2 py-2 text-right tabular-nums align-top">{Number(ln.unit_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-2 text-right tabular-nums align-top font-medium">{lineAmount(ln).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end px-4 py-3 border-t border-gray-100 bg-gray-50/50">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="tabular-nums">{fmtMoney(totals.subtotal, cur)}</span></div>
            {totals.deposit > 0 && (
              <div className="flex justify-between text-gray-500"><span>Deposit ({po.deposit_pct}%)</span><span className="tabular-nums">− {fmtMoney(totals.deposit, cur)}</span></div>
            )}
            <div className="flex justify-between font-semibold pt-1 border-t border-gray-200">
              <span>{totals.deposit > 0 ? 'Balance Due' : 'Total'}</span>
              <span className="tabular-nums">{fmtMoney(totals.balance, cur)}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 italic mb-4">{amountInWords(totals.balance, cur)}</p>

      {po.remarks && (
        <div className="card p-5">
          <p className="text-xs text-gray-500 mb-1">Remarks</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{po.remarks}</p>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete PO "${po.pu_number}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

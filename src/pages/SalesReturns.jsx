import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { SR_STATUSES } from '../constants'
import { srTotals } from '../salesReturns'
import { fmtMoney } from '../currency'
import ExportFilterBar from '../components/ExportFilterBar'
import { downloadCsv, exportStem, inDateRange } from '../exportCsv'

const STATUS_META = Object.fromEntries(SR_STATUSES.map(s => [s.value, s]))

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Sales Return register — Phase B. App-only (no JES history to merge: Sales
// Returns are a new record type this app introduces, see srNumber.js).
export default function SalesReturns() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const q = query(collection(db, 'sales_returns'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (statusFilter && (r.status || 'draft') !== statusFilter) return false
      if ((from || to) && !inDateRange(r.record_date, from, to)) return false
      if (!q) return true
      return [r.sr_no, r.customer_name, r.original_si_no, r.original_uc_no, r.marketplace_ref]
        .some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter, from, to])

  const COLUMNS = [
    { label: 'SR No.',      value: r => r.sr_no, text: true },
    { label: 'Date',        value: r => r.record_date },
    { label: 'Status',      value: r => STATUS_META[r.status || 'draft']?.label || r.status },
    { label: 'Customer',    value: r => r.customer_name },
    { label: 'Channel',     value: r => r.channel },
    { label: 'Original SI', value: r => r.original_si_no, text: true },
    { label: 'Original UC', value: r => r.original_uc_no, text: true },
    { label: 'Disposition', value: r => r.disposition },
    { label: 'Reason',      value: r => r.reason },
    { label: 'Currency',    value: r => r.currency },
    { label: 'Subtotal',    value: r => srTotals(r.lines).subtotal },
    { label: 'Remarks',     value: r => r.remarks, text: true },
  ]
  const exportRows = () => downloadCsv(exportStem('sales-returns', { from, to, type: statusFilter }), COLUMNS, filtered)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Sales Returns</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {rows.length} returns</p>
        </div>
        <Link to="/sales-returns/new" className="btn-primary text-sm whitespace-nowrap">+ New Return</Link>
      </div>

      <ExportFilterBar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        count={filtered.length} total={rows.length} noun="returns"
        onExport={exportRows} disabled={loading}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <input type="text" placeholder="Search SR no., customer, invoice, UC…" className="input w-full sm:flex-1"
               value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1.5">
          {[{ value: '', label: 'All' }, ...SR_STATUSES].map(s => (
            <button key={s.value || 'all'} onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                statusFilter === s.value ? 'bg-ink text-white border-ink' : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No sales returns yet. <Link to="/sales-returns/new" className="text-brand-600 hover:underline">Record your first return</Link>.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-ink-40 border-b border-ivory-dark">
                  <th className="px-3 py-2 font-medium text-left">SR No.</th>
                  <th className="px-3 py-2 font-medium text-left">Customer</th>
                  <th className="px-3 py-2 font-medium text-left">Original SI / UC</th>
                  <th className="px-3 py-2 font-medium text-left">Date</th>
                  <th className="px-3 py-2 font-medium text-left">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(r => {
                  const meta = STATUS_META[r.status || 'draft'] || STATUS_META.draft
                  const { subtotal } = srTotals(r.lines)
                  return (
                    <tr key={r.id} onClick={() => navigate(`/sales-returns/${r.id}`)}
                        className="hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-3 py-2.5 font-mono text-sm font-medium text-gray-900">{r.sr_no || '(no SR no.)'}</td>
                      <td className="px-3 py-2.5 text-gray-700">{r.customer_name || r.marketplace_ref || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{[r.original_si_no, r.original_uc_no].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.record_date ? fmtDate(r.record_date) : '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-800 font-medium whitespace-nowrap">
                        {fmtMoney(subtotal, r.currency || 'USD')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

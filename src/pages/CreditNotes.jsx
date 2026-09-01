import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link, useNavigate } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import { CN_STATUSES } from '../constants'
import { cnTotals } from '../creditNotes'
import { fmtMoney } from '../currency'
import ExportFilterBar from '../components/ExportFilterBar'
import { downloadCsv, exportStem, inDateRange } from '../exportCsv'

const STATUS_META = Object.fromEntries(CN_STATUSES.map(s => [s.value, s]))

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Credit Note register — Sales Return / Credit Note Phase C. Firestore is the
// single source for this list: cn_no/status get stamped back onto the working
// doc the moment it's posted (see CreditNoteForm.jsx), so there's no need to
// separately merge in the Postgres facts here.
export default function CreditNotes() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const q = query(collection(db, 'credit_notes'), orderBy('createdAt', 'desc'))
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
      return [r.cn_no, r.customer_name, r.original_si_no, r.original_uc_no, r.marketplace_ref]
        .some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter, from, to])

  const COLUMNS = [
    { label: 'CN No.',       value: r => r.cn_no, text: true },
    { label: 'Date',         value: r => r.record_date },
    { label: 'Status',       value: r => STATUS_META[r.status || 'draft']?.label || r.status },
    { label: 'Customer',     value: r => r.customer_name },
    { label: 'Channel',      value: r => r.channel },
    { label: 'Original SI',  value: r => r.original_si_no, text: true },
    { label: 'Original UC',  value: r => r.original_uc_no, text: true },
    { label: 'Disposition',  value: r => r.disposition },
    { label: 'Reason',       value: r => r.reason },
    { label: 'Currency',     value: r => r.currency },
    { label: 'System amount', value: r => cnTotals(r.lines).subtotal },
    { label: 'Accounting amount', value: r => r.accounting_amount ?? cnTotals(r.lines).subtotal },
    { label: 'Adjustment reason', value: r => r.adjustment_reason, text: true },
    { label: 'Remarks',      value: r => r.remarks, text: true },
  ]
  const exportRows = () => downloadCsv(exportStem('credit-notes', { from, to, type: statusFilter }), COLUMNS, filtered)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-ink">Credit Notes</h1>
          <p className="text-sm text-ink-60 mt-0.5">{filtered.length} of {rows.length} credit notes</p>
        </div>
        <Link to="/credit-notes/new" className="btn-primary text-sm whitespace-nowrap">+ New Credit Note</Link>
      </div>

      <ExportFilterBar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        count={filtered.length} total={rows.length} noun="credit notes"
        onExport={exportRows} disabled={loading}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <input type="text" placeholder="Search CN no., customer, invoice, UC…" className="input w-full sm:flex-1"
               value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1.5">
          {[{ value: '', label: 'All' }, ...CN_STATUSES].map(s => (
            <button key={s.value || 'all'} onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                statusFilter === s.value ? 'bg-ink text-white border-ink' : 'bg-white text-ink-70 border-warm-grey hover:border-brand-400'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-60">
          No credit notes yet. <Link to="/credit-notes/new" className="text-brand-600 hover:underline">Create your first credit note</Link>.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-ink-60 border-b border-ivory-dark">
                  <th className="px-3 py-2 font-medium text-left">CN No.</th>
                  <th className="px-3 py-2 font-medium text-left">Customer</th>
                  <th className="px-3 py-2 font-medium text-left">Original SI / UC</th>
                  <th className="px-3 py-2 font-medium text-left">Date</th>
                  <th className="px-3 py-2 font-medium text-left">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-grey">
                {filtered.map(r => {
                  const meta = STATUS_META[r.status || 'draft'] || STATUS_META.draft
                  const amount = r.accounting_amount ?? cnTotals(r.lines).subtotal
                  return (
                    <tr key={r.id} onClick={() => navigate(`/credit-notes/${r.id}`)}
                        className={`hover:bg-ivory transition-colors cursor-pointer ${r.status === 'void' ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2.5 font-mono text-sm font-medium text-ink">{r.cn_no || '(draft)'}</td>
                      <td className="px-3 py-2.5 text-ink-80">{r.customer_name || r.marketplace_ref || '—'}</td>
                      <td className="px-3 py-2.5 text-ink-60 font-mono text-xs">{[r.original_si_no, r.original_uc_no].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-3 py-2.5 text-ink-60 whitespace-nowrap">{r.record_date ? fmtDate(r.record_date) : '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink font-medium whitespace-nowrap">
                        {fmtMoney(amount, r.currency || 'USD')}
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

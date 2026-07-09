import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import useScrollMemory from '../hooks/useScrollMemory'
import { PO_STATUSES } from '../constants'
import { fmtMoney } from '../currency'
import { poTotals } from '../purchaseOrders'
import { FileText } from 'lucide-react'

const STATUS_META = Object.fromEntries(PO_STATUSES.map(s => [s.value, s]))

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PurchaseOrders() {
  const [pos, setPos] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const remember = useScrollMemory('purchase-orders', !loading)

  useEffect(() => {
    // Order by createdAt so every doc is included (issued_date can be blank).
    const q = query(collection(db, 'purchase_orders'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setPos(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pos.filter(p => {
      if (statusFilter && (p.status || 'draft') !== statusFilter) return false
      if (!q) return true
      return [p.pu_number, p.supplier_name, p.supplier_name_cn, p.supplier_erp_code]
        .some(v => (v || '').toLowerCase().includes(q))
    })
  }, [pos, search, statusFilter])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} of {pos.length} POs</p>
        </div>
        <Link to="/purchase-orders/new" className="btn-primary text-sm whitespace-nowrap">+ New PO</Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input type="text" placeholder="Search PU no. or supplier…" className="input w-full sm:flex-1"
               value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1.5">
          {[{ value: '', label: 'All' }, ...PO_STATUSES].map(s => (
            <button key={s.value || 'all'} onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                statusFilter === s.value ? 'bg-ink text-white border-ink' : 'bg-white text-gray-600 border-gray-200 hover:border-brand-400'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!loading && pos.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No purchase orders yet. <Link to="/purchase-orders/new" className="text-brand-600 hover:underline">Create your first PO</Link>.
        </div>
      ) : (
        <div className="card divide-y divide-gray-100 overflow-hidden">
          {filtered.map(p => {
            const meta = STATUS_META[p.status || 'draft'] || STATUS_META.draft
            const { balance } = poTotals(p)
            return (
              <Link key={p.id} to={`/purchase-orders/${p.id}`} onClick={remember}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <FileText size={18} className="text-gray-300 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium text-gray-900">{p.pu_number || '(no PU no.)'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {p.supplier_name || '—'}{p.supplier_name_cn ? ` · ${p.supplier_name_cn}` : ''}
                    {p.issued_date ? ` · ${fmtDate(p.issued_date)}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium tabular-nums text-gray-800">{fmtMoney(balance, p.currency || 'RMB')}</p>
                  <p className="text-[10px] text-gray-400">{(p.lines?.length || 0)} line{(p.lines?.length || 0) === 1 ? '' : 's'}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

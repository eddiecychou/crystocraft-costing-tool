import { useState, useEffect, useMemo } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Link } from 'react-router-dom'
import LoadingBar from '../components/LoadingBar'
import useScrollMemory from '../hooks/useScrollMemory'
import { PO_STATUSES } from '../constants'
import { fmtMoney } from '../currency'
import { poTotals } from '../purchaseOrders'
import { erpLookup } from '../erpApi'
import ErpDocModal from '../components/ErpDocModal'
import { FileText, Database } from 'lucide-react'
import ExportFilterBar from '../components/ExportFilterBar'
import { downloadCsv, exportStem, inDateRange } from '../exportCsv'

const STATUS_META = Object.fromEntries(PO_STATUSES.map(s => [s.value, s]))

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// JES history for Purchase Orders — same pattern as Shipping.jsx's
// useErpOrders (JES was frozen 2026-08-05: no new rows will ever appear here,
// but everything raised before the freeze still needs to be visible). Search-
// driven and debounced so a blank search doesn't try to pull all 4,256
// historical rows; a bounded default limit keeps the unfiltered view to
// roughly the last couple of years without a full-history fetch.
function useErpPurchaseOrders(search) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    const t = setTimeout(() => {
      erpLookup('purchase', { q: search.trim(), limit: search.trim() ? 200 : 400 })
        .then(r => { if (alive) setRows(r || []) })
        .catch(e => { if (alive) { setError(e.message || 'Could not reach the ERP archive.'); setRows([]) } })
        .finally(() => { if (alive) setLoading(false) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [search])
  return { rows, loading, error }
}

// Totals for a merged row regardless of source — an ERP row has none of
// poTotals()'s inputs (lines/adjustments/deposit_pct), only a flat amount.
function rowTotals(row) {
  if (row.src === 'app') return poTotals(row.o)
  const amount = Number(row.r.amount) || 0
  const deposit = Number(row.r.deposit) || 0
  return { totalQty: null, subtotal: amount, adjustmentsTotal: 0, grandTotal: amount, deposit, balance: amount - deposit }
}

export default function PurchaseOrders() {
  const [pos, setPos] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [erpDoc, setErpDoc] = useState(null)   // JES purchase order being viewed, read-only
  const remember = useScrollMemory('purchase-orders', !loading)

  useEffect(() => {
    // Order by createdAt so every doc is included (issued_date can be blank).
    const q = query(collection(db, 'purchase_orders'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, snap => {
      setPos(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))   // surface an empty state instead of hanging on a read error
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pos.filter(p => {
      if (statusFilter && (p.status || 'draft') !== statusFilter) return false
      // Dates come from issued_date, which can be blank on a draft — an undated
      // PO is excluded once a range is set, rather than silently included.
      if ((from || to) && !inDateRange(p.issued_date, from, to)) return false
      if (!q) return true
      return [p.pu_number, p.supplier_name, p.supplier_name_cn, p.supplier_erp_code]
        .some(v => (v || '').toLowerCase().includes(q))
    })
  }, [pos, search, statusFilter, from, to])

  const erp = useErpPurchaseOrders(search)
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  // Clicking the active column flips direction; picking a new column starts
  // it at a sensible default (dates newest-first, text columns A→Z).
  function toggleSort(key) {
    if (sortKey === key) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'date' ? 'desc' : 'asc')
  }

  // One accessor per sortable column, working across both row sources — a
  // JES row has no supplier_erp_code equivalent to the app's field name
  // (erp_purchase's own `supplier_code` is the closest match).
  const SORT_VALUE = {
    pu:            row => (row.src === 'app' ? row.o.pu_number : row.r.code) || '',
    supplier:      row => (row.src === 'app' ? row.o.supplier_name : row.r.supplier) || '',
    supplier_code: row => (row.src === 'app' ? row.o.supplier_erp_code : row.r.supplier_code) || '',
    date:          row => (row.src === 'app' ? row.o.issued_date : row.r.date) || '',
  }

  // App rows and JES rows in one list, de-duplicated by PU number with the app
  // row winning — an app PO that was also typed into JES before the freeze
  // shows once, as the app's own (editable) copy.
  const merged = useMemo(() => {
    const app = filtered.map(o => ({ src: 'app', key: `app-${o.id}`, o }))
    const appPu = new Set(filtered.map(o => (o.pu_number || '').trim().toUpperCase()).filter(Boolean))
    const jes = (erp.rows || [])
      .filter(r => !appPu.has((r.code || '').trim().toUpperCase()))
      // Status filter only applies to app rows (JES's own status vocabulary
      // doesn't map to PO_STATUSES) — showing JES rows regardless keeps
      // "Draft"/"Issued" from silently hiding archive history.
      .map(r => ({ src: 'jes', key: `erp-${r.code}`, r }))
    const get = SORT_VALUE[sortKey] || SORT_VALUE.date
    const dir = sortDir === 'asc' ? 1 : -1
    return [...app, ...jes].sort((a, b) => String(get(a)).localeCompare(String(get(b))) * dir)
  }, [filtered, erp.rows, sortKey, sortDir])

  const jesOnlyCount = merged.length - filtered.length

  // Columns follow the PO screen, plus the money Cindy needs for the books.
  // CSV export covers whatever is currently merged/visible, app or JES.
  const PO_COLUMNS = [
    { label: 'Source',        value: r => r.src === 'app' ? 'App' : 'JES' },
    { label: 'PU No.',        value: r => r.src === 'app' ? r.o.pu_number : r.r.code, text: true },
    { label: 'Issued',        value: r => r.src === 'app' ? r.o.issued_date : r.r.date },
    { label: 'Status',        value: r => r.src === 'app' ? (STATUS_META[r.o.status || 'draft']?.label || r.o.status || 'draft') : (r.r.status || '') },
    { label: 'Supplier',      value: r => r.src === 'app' ? r.o.supplier_name : r.r.supplier },
    { label: 'Supplier (CN)', value: r => r.src === 'app' ? r.o.supplier_name_cn : '' },
    { label: 'Supplier code', value: r => r.src === 'app' ? r.o.supplier_erp_code : r.r.supplier_code, text: true },
    { label: 'Currency',      value: r => r.src === 'app' ? r.o.currency : r.r.currency },
    { label: 'Lines',         value: r => r.src === 'app' ? (r.o.lines || []).length : '' },
    { label: 'Subtotal',      value: r => rowTotals(r).subtotal.toFixed(2) },
    { label: 'Total',         value: r => rowTotals(r).grandTotal.toFixed(2) },
    { label: 'Deposit',       value: r => rowTotals(r).deposit.toFixed(2) },
    { label: 'Balance',       value: r => rowTotals(r).balance.toFixed(2) },
  ]

  const exportPos = () => downloadCsv(
    exportStem('purchase-orders', { from, to, type: statusFilter }),
    PO_COLUMNS, merged,
  )

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {loading && <LoadingBar />}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filtered.length} of {pos.length} app POs
            {jesOnlyCount > 0 && <> · {jesOnlyCount} more from JES{erp.loading ? ' (loading…)' : ''}</>}
          </p>
        </div>
        <Link to="/purchase-orders/new" className="btn-primary text-sm whitespace-nowrap">+ New PO</Link>
      </div>

      <ExportFilterBar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        count={merged.length} total={pos.length + (erp.rows?.length || 0)} noun="POs"
        onExport={exportPos} disabled={loading}
      />

      {erp.error && (
        <p className="text-xs text-amber-600 mb-2">JES history unavailable — {erp.error}</p>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-2">
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

      <div className="flex items-center gap-1.5 mb-4">
        <span className="text-xs text-gray-400">Sort:</span>
        {[
          ['date', 'Date'], ['pu', 'PU No.'], ['supplier', 'Supplier'], ['supplier_code', 'Supplier code'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => toggleSort(key)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors inline-flex items-center gap-1 ${
                    sortKey === key ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-brand-400'}`}>
            {label}{sortKey === key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
          </button>
        ))}
      </div>

      {erpDoc && <ErpDocModal of="purchase" doc={erpDoc} onClose={() => setErpDoc(null)} />}

      {!loading && merged.length === 0 && !erp.loading ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No purchase orders yet. <Link to="/purchase-orders/new" className="text-brand-600 hover:underline">Create your first PO</Link>.
        </div>
      ) : (
        <div className="card divide-y divide-gray-100 overflow-hidden">
          {merged.map(row => row.src === 'app'
            ? <AppPoRow key={row.key} p={row.o} onNavigate={remember} />
            : <JesPoRow key={row.key} r={row.r} onOpen={() => setErpDoc(row.r)} />
          )}
        </div>
      )}
    </div>
  )
}

function AppPoRow({ p, onNavigate }) {
  const meta = STATUS_META[p.status || 'draft'] || STATUS_META.draft
  const { balance } = poTotals(p)
  return (
    <Link to={`/purchase-orders/${p.id}`} onClick={onNavigate}
          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
      <FileText size={18} className="text-gray-300 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium text-gray-900">{p.pu_number || '(no PU no.)'}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
          {!p.pu_number && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Needs PU #</span>
          )}
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
}

// A JES purchase order, pre-freeze history only — read-only, opens ErpDocModal
// (same component Shipping.jsx and SalesInvoices.jsx already use for their own
// JES history) rather than the app's PO editor, which can't amend a JES doc.
function JesPoRow({ r, onOpen }) {
  const void_ = (r.status || '').trim().toUpperCase() === 'VOID'
  return (
    <button type="button" onClick={onOpen}
            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left ${void_ ? 'opacity-60' : ''}`}>
      <Database size={18} className="text-gray-300 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium text-gray-900">{(r.code || '').trim()}</span>
          <span title="Historical purchase order from JES — read-only archive"
                className="text-[10px] font-medium text-ink-40 inline-flex items-center gap-1 border border-ivory-dark rounded-full px-2 py-0.5">
            <Database size={10} /> JES
          </span>
          {void_ && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Void</span>}
        </div>
        <p className="text-xs text-gray-500 truncate">
          {r.supplier || '—'}{r.date ? ` · ${fmtDate(r.date)}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium tabular-nums text-gray-800">
          {r.amount != null ? fmtMoney(Number(r.amount), r.currency || 'RMB') : '—'}
        </p>
        <p className="text-[10px] text-gray-400">{(r.status || '').trim() || '—'}</p>
      </div>
    </button>
  )
}

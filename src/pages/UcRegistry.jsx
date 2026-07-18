import { useMemo, useState } from 'react'
import { Search, Hash, Plus, X, AlertCircle } from 'lucide-react'
import LoadingBar from '../components/LoadingBar'
import { useUcList, createUcInvoice, updateUcInvoice, UC_SOURCES, UC_CURRENCIES } from '../ucRegistry'

const money = (v) => (v === '' || v == null || Number.isNaN(Number(v)))
  ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_STYLE = {
  open: { cls: 'bg-green-100 text-green-700', label: 'Open' },
  closed: { cls: 'bg-gray-100 text-gray-500', label: 'Closed' },
  void: { cls: 'bg-red-100 text-red-700', label: 'Void' },
}

const SOURCE_STYLE = {
  ERP: 'bg-gray-100 text-gray-600', Alibaba: 'bg-orange-100 text-orange-700',
  Amazon: 'bg-yellow-100 text-yellow-800', 'Online Shop': 'bg-blue-100 text-blue-700',
  Retail: 'bg-purple-100 text-purple-700', Other: 'bg-gray-100 text-gray-500',
}

const BLANK = { source: 'ERP', currency: 'HKD', status: 'open', confirmed: false }

// ── New / Edit form modal ─────────────────────────────────────────────────────
function UcForm({ record, onClose, onSaved }) {
  const isNew = !record?.id
  const [f, setF] = useState(record || BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function save() {
    if (!f.customer?.trim()) { setError('Customer is required.'); return }
    setSaving(true); setError('')
    try {
      if (isNew) await createUcInvoice(f)
      else await updateUcInvoice(record.id, f)
      onSaved()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  // A plain function (not a nested component) so inputs don't remount/lose focus.
  const field = (label, k, type = 'text', wide = false) => (
    <label key={k} className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <input type={type} value={f[k] ?? ''} onChange={set(k)}
        className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500" />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Hash size={18} className="text-teal-600" />
            {isNew ? 'New UC# Invoice' : `Edit ${record.uc_no}`}
            {isNew && <span className="text-xs font-normal text-gray-400">— number assigned on save</span>}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">Source</span>
            <select value={f.source} onChange={set('source')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg">
              {UC_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          {field('Year (e.g. /26)', 'year')}
          {field('Customer', 'customer', 'text', true)}
          {field('JES SI# (ERP invoice)', 'jes_si')}
          {field('Order no.', 'order_no')}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">Currency</span>
            <select value={f.currency} onChange={set('currency')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg">
              {UC_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {field('PIC', 'pic')}
          {field('Total', 'total', 'number')}
          {field('Deposit', 'deposit', 'number')}
          {field('Balance (blank = total − deposit)', 'balance', 'number')}
          {field('Balance payment date', 'bal_pay_date')}
          {field('Shipment', 'shipment')}
          {field('Shipping cost', 'shipping_cost', 'number')}
          {field('Customs (報關)', 'customs')}
          {field('Delivery date', 'delivery_date')}
          <label className="flex items-center gap-2 text-sm text-gray-600 mt-1">
            <input type="checkbox" checked={!!f.confirmed} onChange={set('confirmed')}
              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" /> Confirmed
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">Status</span>
            <select value={f.status || 'open'} onChange={set('status')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg">
              <option value="open">Open</option>
              <option value="closed">Closed (paid)</option>
              <option value="void">Void (cancelled / mistake)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs font-medium text-gray-500">Remarks</span>
            <textarea value={f.remarks ?? ''} onChange={set('remarks')} rows={2}
              className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg" />
          </label>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border-t border-red-200 px-5 py-2">
            <AlertCircle size={16} /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Saving…' : isNew ? 'Create UC#' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UcRegistry() {
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')   // '' = all
  const [editing, setEditing] = useState(null)   // record | 'new' | null

  const list = useUcList({ q, source, status: statusFilter, limit: 500 })
  const arList = useUcList({ status: 'open', limit: 1000 })   // outstanding summary (all open)
  const rows = list.rows
  const refreshAll = () => { list.refresh(); arList.refresh() }

  // Outstanding totals by currency (from the open set).
  const ar = useMemo(() => {
    const by = {}
    for (const r of arList.rows) {
      const c = r.currency || '?'
      by[c] = (by[c] || 0) + (Number(r.balance) || 0)
    }
    return Object.entries(by).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => b[1] - a[1])
  }, [arList.rows])

  return (
    <div className="p-4 md:p-6">
      {list.loading && <LoadingBar />}

      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Hash size={22} className="text-teal-600" /> UC Invoice Registry
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Every order gets a unique UC# — across ERP, Alibaba, Amazon, online shop, and retail.
          </p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-primary text-sm inline-flex items-center gap-1">
          <Plus size={15} /> New UC#
        </button>
      </div>

      {/* AR summary */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ar.length === 0 ? (
          <span className="text-sm text-gray-400">No outstanding balances.</span>
        ) : (
          <>
            <span className="text-sm text-gray-500 self-center mr-1">Outstanding:</span>
            {ar.map(([c, v]) => (
              <span key={c} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                <b className="tabular-nums">{money(v)}</b> <span className="text-gray-500">{c}</span>
              </span>
            ))}
          </>
        )}
      </div>

      {list.error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={16} /> {list.error}
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search UC#, customer, SI#, order…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500" />
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="px-2.5 py-2 text-sm border border-gray-200 rounded-lg">
          <option value="">All sources</option>
          {UC_SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2.5 py-2 text-sm border border-gray-200 rounded-lg">
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="void">Void</option>
          <option value="">All statuses</option>
        </select>
        <span className="text-sm text-gray-400 tabular-nums">{rows.length} shown</span>
      </div>

      {/* table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                {['UC #', 'Yr', 'Source', 'Customer', 'JES SI#', 'Cur'].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2 font-medium text-right">Balance</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${r.status === 'void' ? 'opacity-55' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs">{r.uc_no}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.year}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${SOURCE_STYLE[r.source] || SOURCE_STYLE.Other}`}>{r.source}</span>
                  </td>
                  <td className="px-3 py-2">{r.customer}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.jes_si || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.currency}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.total)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${Number(r.balance) > 0.005 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{money(r.balance)}</td>
                  <td className="px-3 py-2">
                    {(() => { const st = STATUS_STYLE[r.status] || STATUS_STYLE.open
                      return <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span> })()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(r)} className="text-teal-600 hover:underline text-xs font-medium">Edit</button>
                  </td>
                </tr>
              ))}
              {!list.loading && rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">No matching UC# records.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <UcForm
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshAll() }}
        />
      )}
    </div>
  )
}

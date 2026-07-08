import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useOrders, getOrderLines, orderStatusOf } from '../shipping'
import { loadComponents } from '../criticalComponents'
import { computeRequirements } from '../mrp'
import LoadingBar from '../components/LoadingBar'
import { AlertTriangle, Download, Boxes, Calculator, Info } from 'lucide-react'

// Statuses that represent live demand — pre-selected in the picker.
const DEMAND = ['confirmed', 'packing', 'ready']

const orderLabel = o => (o.erp_pi_no ? `PI ${o.erp_pi_no}` : (o.customer_name || o.id))

function toCsv(rows) {
  const head = ['Component', 'Name', 'Plating', 'Required', 'In stock', 'Shortage', 'Lead (wk)', 'Used by']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const out = [head.map(esc).join(',')]
  for (const r of rows) {
    out.push([r.code, r.name, r.plating_code || '-', r.required, r.inStock, r.shortage, r.leadWeeks ?? '', r.usedBy.join('; ')].map(esc).join(','))
  }
  return out.join('\n')
}

export default function ComponentRequirements() {
  const { orders, loading } = useOrders()
  const [productsById, setProductsById] = useState({})
  const [lib, setLib] = useState([])
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [seeded, setSeeded] = useState(false)
  const [result, setResult] = useState(null)
  const [computing, setComputing] = useState(false)
  const [onlyShort, setOnlyShort] = useState(true)

  // Load products (with BOMs) + component library once.
  useEffect(() => {
    Promise.all([getDocs(collection(db, 'range_products')), loadComponents()])
      .then(([psnap, comps]) => {
        const byId = {}
        psnap.forEach(d => { byId[d.id] = { id: d.id, ...d.data() } })
        setProductsById(byId); setLib(comps); setReady(true)
      })
  }, [])

  // Pre-select live-demand orders once, the first time orders arrive.
  useEffect(() => {
    if (seeded || loading || !orders.length) return
    setSelected(new Set(orders.filter(o => DEMAND.includes(o.status)).map(o => o.id)))
    setSeeded(true)
  }, [orders, loading, seeded])

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '')),
    [orders],
  )

  function toggle(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    setResult(null)
  }

  async function compute() {
    setComputing(true); setResult(null)
    try {
      const chosen = orders.filter(o => selected.has(o.id))
      const lines = []
      for (const o of chosen) {
        const ls = await getOrderLines(o.id)
        const label = orderLabel(o)
        ls.forEach(l => lines.push({ ...l, order_label: label }))
      }
      setResult(computeRequirements({ lines, productsById, lib }))
    } finally {
      setComputing(false)
    }
  }

  const shownRows = result ? (onlyShort ? result.rows.filter(r => r.shortage > 0) : result.rows) : []
  const shortCount = result ? result.rows.filter(r => r.shortage > 0).length : 0

  function exportCsv() {
    const blob = new Blob([toCsv(shownRows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `component-requirements-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {(loading || !ready) && <LoadingBar />}

      <p className="text-sm text-gray-500 mb-4">
        Select confirmed PIs to explode their figurine components, deduct current stock, and see what to order.
      </p>

      {/* Order picker */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Boxes size={15} /> Orders ({selected.size} selected)</h2>
          <div className="flex gap-3 text-xs">
            <button onClick={() => setSelected(new Set(orders.filter(o => DEMAND.includes(o.status)).map(o => o.id)))} className="text-brand-600 hover:underline">Confirmed +</button>
            <button onClick={() => { setSelected(new Set()); setResult(null) }} className="text-gray-500 hover:underline">Clear</button>
          </div>
        </div>
        {sortedOrders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No orders yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
            {sortedOrders.map(o => {
              const st = orderStatusOf(o.status)
              return (
                <label key={o.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-brand-600" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                  <span className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800 truncate">{o.customer_name || 'Unnamed'}</span>
                    {o.erp_pi_no && <span className="text-xs text-gray-400">PI {o.erp_pi_no}</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                  </span>
                  {o.order_date && <span className="text-xs text-gray-400 shrink-0">{o.order_date}</span>}
                </label>
              )
            })}
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={compute} disabled={!ready || computing || selected.size === 0}
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40">
            <Calculator size={15} /> {computing ? 'Computing…' : 'Compute requirements'}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{shortCount}</span> component{shortCount === 1 ? '' : 's'} short
              <span className="text-gray-400"> · {result.rows.length} required in total</span>
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={onlyShort} onChange={e => setOnlyShort(e.target.checked)} className="w-3.5 h-3.5 rounded border-gray-300 text-brand-600" />
                Shortages only
              </label>
              <button onClick={exportCsv} disabled={shownRows.length === 0} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-40">
                <Download size={13} /> Export CSV
              </button>
            </div>
          </div>

          <div className="card overflow-hidden mb-4">
            {shownRows.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                {onlyShort ? 'No shortages — every required component is in stock.' : 'No components required.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-3 py-2 font-medium">Component</th>
                      <th className="px-3 py-2 font-medium">Plating</th>
                      <th className="px-3 py-2 font-medium text-right">Required</th>
                      <th className="px-3 py-2 font-medium text-right">In stock</th>
                      <th className="px-3 py-2 font-medium text-right">Shortage</th>
                      <th className="px-3 py-2 font-medium text-right">Lead</th>
                      <th className="px-3 py-2 font-medium">Used by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {shownRows.map(r => (
                      <tr key={r.code} className={r.shortage > 0 ? 'bg-red-50/40' : ''}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800 font-mono text-xs">{r.code}</div>
                          {r.name && <div className="text-xs text-gray-400">{r.name}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{r.plating_code || <span className="text-gray-300">shared</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.required}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.inStock}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.shortage > 0 ? 'text-red-600' : 'text-gray-300'}`}>{r.shortage || '—'}</td>
                        <td className="px-3 py-2 text-right text-xs text-gray-500">{r.leadWeeks != null ? `${r.leadWeeks}w` : '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{r.usedBy.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Warnings — things that couldn't be exploded cleanly */}
          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 mb-3">
              <p className="text-xs font-semibold text-amber-800 inline-flex items-center gap-1.5 mb-1.5"><AlertTriangle size={13} /> {result.warnings.length} line{result.warnings.length === 1 ? '' : 's'} need attention</p>
              <ul className="space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    <span className="font-mono">{w.item_code || '(no code)'}</span>{w.order && <span className="text-amber-600"> · {w.order}</span>} — {w.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Skipped — non-figurine lines, informational */}
          {result.skipped.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer inline-flex items-center gap-1.5"><Info size={12} /> {result.skipped.length} non-figurine line{result.skipped.length === 1 ? '' : 's'} skipped</summary>
              <ul className="mt-1.5 space-y-0.5 pl-5">
                {result.skipped.map((s, i) => (
                  <li key={i}><span className="font-mono">{s.item_code || '(no code)'}</span>{s.order && ` · ${s.order}`} — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

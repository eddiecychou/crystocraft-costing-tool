import { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useOrders, getOrderLines, orderStatusOf, orderUc } from '../shipping'
import { loadComponents } from '../criticalComponents'
import { loadCrystals } from '../crystals'
import { computeRequirements } from '../mrp'
import LoadingBar from '../components/LoadingBar'
import { AlertTriangle, Download, Boxes, Calculator, Info, Gem } from 'lucide-react'

// Statuses that represent live demand — pre-selected in the picker.
const DEMAND = ['confirmed', 'packing', 'ready']

const orderLabel = o => orderUc(o) || o.customer_name || o.id

// One file for both, with a Kind column: a crystal and a component can share a
// shortage list without either being mistaken for the other.
function toCsv(rows, crystalRows = []) {
  const head = ['Kind', 'Code', 'Name', 'Plating', 'Required', 'Available', 'Shortage', 'Lead (wk)', 'Used by']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const out = [head.map(esc).join(',')]
  for (const r of rows) {
    out.push(['Component', r.code, r.name, r.plating_code || '-', r.required, r.inStock, r.shortage, r.leadWeeks ?? '', r.usedBy.join('; ')].map(esc).join(','))
  }
  for (const r of crystalRows) {
    out.push(['Crystal', r.code, r.name, '-', r.required, r.inStock, r.shortage, '', r.usedBy.join('; ')].map(esc).join(','))
  }
  return out.join('\n')
}

export default function ComponentRequirements() {
  const { orders, loading } = useOrders()
  const [productsById, setProductsById] = useState({})
  const [lib, setLib] = useState([])
  const [crystals, setCrystals] = useState([])
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [seeded, setSeeded] = useState(false)
  const [result, setResult] = useState(null)
  const [computing, setComputing] = useState(false)
  const [onlyShort, setOnlyShort] = useState(true)
  const [showAll, setShowAll] = useState(false)   // false = live-demand orders only

  // Load products (with BOMs) + component library once.
  useEffect(() => {
    Promise.all([getDocs(collection(db, 'range_products')), loadComponents(), loadCrystals()])
      .then(([psnap, comps, stones]) => {
        const byId = {}
        psnap.forEach(d => { byId[d.id] = { id: d.id, ...d.data() } })
        setProductsById(byId); setLib(comps); setCrystals(stones); setReady(true)
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
  // Default view = live-demand orders only (Confirmed/Packing/Ready), so the
  // picker opens showing exactly the orders you'd plan against — not 11 already-
  // shipped/delivered ones buried in a scroll box. Toggle reveals everything.
  const demandCount = useMemo(() => sortedOrders.filter(o => DEMAND.includes(o.status)).length, [sortedOrders])
  const visibleOrders = useMemo(
    () => (showAll ? sortedOrders : sortedOrders.filter(o => DEMAND.includes(o.status))),
    [sortedOrders, showAll],
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
      let reservedSkipped = 0
      for (const o of chosen) {
        // An order that has already reserved (or produced-in) its components has
        // set that stock aside — its demand is covered, so counting it again
        // against the now-lower Available would over-order. Skip it.
        const raw = o._raw || o
        if (raw.components_reserved || raw.components_committed) { reservedSkipped++; continue }
        const ls = await getOrderLines(o.id)
        const label = orderLabel(o)
        ls.forEach(l => lines.push({ ...l, order_label: label }))
      }
      const res = computeRequirements({ lines, products: Object.values(productsById), lib, crystals })
      setResult({ ...res, reservedSkipped })
    } finally {
      setComputing(false)
    }
  }

  const shownRows = result ? (onlyShort ? result.rows.filter(r => r.shortage > 0) : result.rows) : []
  const shortCount = result ? result.rows.filter(r => r.shortage > 0).length : 0
  const crystalAll = result?.crystalRows || []
  const shownCrystals = onlyShort ? crystalAll.filter(r => r.shortage > 0) : crystalAll
  const crystalShort = crystalAll.filter(r => r.shortage > 0).length

  function exportCsv() {
    const blob = new Blob([toCsv(shownRows, shownCrystals)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `material-requirements-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {(loading || !ready) && <LoadingBar />}

      <p className="text-sm text-ink-60 mb-4">
        Select confirmed PIs to explode their figurine components, deduct current stock, and see what to order.
      </p>

      {/* Order picker */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-warm-grey">
          <h2 className="text-sm font-semibold text-ink-80 inline-flex items-center gap-1.5">
            <Boxes size={15} /> Orders
            <span className="font-normal text-ink-60">· {selected.size} selected · showing {visibleOrders.length} of {sortedOrders.length}</span>
          </h2>
          <div className="flex gap-3 text-xs">
            <button onClick={() => setShowAll(s => !s)} className="text-brand-600 hover:underline">
              {showAll ? 'Confirmed + only' : `Show all (${sortedOrders.length})`}
            </button>
            <button onClick={() => setSelected(new Set(orders.filter(o => DEMAND.includes(o.status)).map(o => o.id)))} className="text-brand-600 hover:underline">Select demand</button>
            <button onClick={() => { setSelected(new Set()); setResult(null) }} className="text-ink-60 hover:underline">Clear</button>
          </div>
        </div>
        {visibleOrders.length === 0 ? (
          <p className="text-sm text-ink-60 text-center py-8">
            {sortedOrders.length === 0 ? 'No orders yet.' : `No confirmed / packing / ready orders. `}
            {sortedOrders.length > 0 && <button onClick={() => setShowAll(true)} className="text-brand-600 hover:underline">Show all {sortedOrders.length}</button>}
          </p>
        ) : (
          <div className="divide-y divide-warm-grey">
            {visibleOrders.map(o => {
              const st = orderStatusOf(o.status)
              return (
                <label key={o.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ivory cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded-sm border-warm-grey text-brand-600" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                  <span className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink truncate">{o.customer_name || 'Unnamed'}</span>
                    {orderUc(o) && <span className="text-xs text-ink-60">{orderUc(o)}</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${st.style}`}>{st.label}</span>
                  </span>
                  {o.order_date && <span className="text-xs text-ink-60 shrink-0">{o.order_date}</span>}
                </label>
              )
            })}
          </div>
        )}
        <div className="px-4 py-3 border-t border-warm-grey">
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
            <p className="text-sm text-ink-70">
              <span className="font-semibold text-ink">{shortCount}</span> component{shortCount === 1 ? '' : 's'} short
              <span className="text-ink-60"> · {result.rows.length} required in total</span>
              {result.unmatched.length > 0 && <span className="text-red-600 font-medium"> · {result.unmatched.length} not in range</span>}
              {result.reservedSkipped > 0 && <span className="text-amber-600"> · {result.reservedSkipped} reserved order{result.reservedSkipped === 1 ? '' : 's'} excluded (already set aside)</span>}
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-ink-60 inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={onlyShort} onChange={e => setOnlyShort(e.target.checked)} className="w-3.5 h-3.5 rounded-sm border-warm-grey text-brand-600" />
                Shortages only
              </label>
              <button onClick={exportCsv} disabled={shownRows.length === 0} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-40">
                <Download size={13} /> Export CSV
              </button>
            </div>
          </div>

          <div className="card overflow-hidden mb-4">
            {shownRows.length === 0 ? (
              <p className="text-sm text-ink-60 text-center py-8">
                {onlyShort ? 'No shortages — every required component is in stock.' : 'No components required.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-60 border-b border-warm-grey">
                      <th className="px-3 py-2 font-medium">Component</th>
                      <th className="px-3 py-2 font-medium">Plating</th>
                      <th className="px-3 py-2 font-medium text-right">Required</th>
                      <th className="px-3 py-2 font-medium text-right">Available</th>
                      <th className="px-3 py-2 font-medium text-right">Shortage</th>
                      <th className="px-3 py-2 font-medium text-right">Lead</th>
                      <th className="px-3 py-2 font-medium">Used by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warm-grey">
                    {shownRows.map(r => (
                      <tr key={r.code} className={r.shortage > 0 ? 'bg-red-50/40' : ''}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-ink font-mono text-xs">{r.code}</div>
                          {r.name && <div className="text-xs text-ink-60">{r.name}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-60">{r.plating_code || <span className="text-platinum">shared</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.required}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-60">{r.inStock}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.shortage > 0 ? 'text-red-600' : 'text-platinum'}`}>{r.shortage || '—'}</td>
                        <td className="px-3 py-2 text-right text-xs text-ink-60">{r.leadWeeks != null ? `${r.leadWeeks}w` : '—'}</td>
                        <td className="px-3 py-2 text-xs text-ink-60">{r.usedBy.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Crystals. A separate table rather than merged rows: they come from
              their own inventory, have no lead time or plating, and are counted
              per stone rather than per part. Only shown once a product in the
              selection actually carries a crystal BOM. */}
          {crystalAll.length > 0 && (
            <div className="bg-white rounded-none border border-warm-grey mb-3">
              <div className="px-4 py-2.5 border-b border-warm-grey flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-80 inline-flex items-center gap-1.5">
                  <Gem size={14} className="text-brand-500" />
                  Crystals
                  <span className="font-normal text-ink-60">
                    · {crystalShort} short of {crystalAll.length} required
                  </span>
                </h2>
              </div>
              {shownCrystals.length === 0 ? (
                <p className="px-4 py-3 text-xs text-ink-60">
                  No crystal shortages — every stone is covered by available stock.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-60 border-b border-warm-grey">
                        <th className="px-3 py-2 font-medium">Crystal</th>
                        <th className="px-3 py-2 font-medium text-right">Required</th>
                        <th className="px-3 py-2 font-medium text-right">Available</th>
                        <th className="px-3 py-2 font-medium text-right">Shortage</th>
                        <th className="px-3 py-2 font-medium">Used by</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-warm-grey">
                      {shownCrystals.map(r => (
                        <tr key={r.code} className={r.shortage > 0 ? 'bg-red-50/40' : ''}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-ink font-mono text-xs">{r.code}</div>
                            {r.name && <div className="text-xs text-ink-60">{r.name}</div>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.required}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-60">{r.inStock}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.shortage > 0 ? 'text-red-600' : 'text-platinum'}`}>{r.shortage || '—'}</td>
                          <td className="px-3 py-2 text-xs text-ink-60">{r.usedBy.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Not in product range — figurine codes we couldn't match. Flagged
              loudly so they aren't silently left out of the order plan. */}
          {result.unmatched.length > 0 && (
            <div className="rounded-none border border-red-300 bg-red-50 px-4 py-3 mb-3">
              <p className="text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 mb-1.5">
                <AlertTriangle size={13} /> {result.unmatched.length} item{result.unmatched.length === 1 ? '' : 's'} not in the product range — components can’t be computed
              </p>
              <p className="text-2xs text-red-600/80 mb-1.5">Add these to Figurine Gifts (with their critical components), or check the item code, then recompute.</p>
              <ul className="space-y-0.5">
                {result.unmatched.map((u, i) => (
                  <li key={i} className="text-xs text-red-800">
                    <span className="font-mono font-medium">{u.item_code || '(no code)'}</span>
                    {u.qty != null && <span className="text-red-600"> · {u.qty} pcs</span>}
                    {u.order && <span className="text-red-500"> · {u.order}</span>}
                    {u.description && <span className="text-red-600/80"> — {u.description.slice(0, 70)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings — things that couldn't be exploded cleanly */}
          {result.warnings.length > 0 && (
            <div className="rounded-none border border-amber-300 bg-amber-50 px-4 py-3 mb-3">
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
            <details className="text-xs text-ink-60">
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

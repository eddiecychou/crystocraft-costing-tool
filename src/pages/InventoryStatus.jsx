import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useComponents } from '../criticalComponents'
import { useCrystals } from '../crystals'
import { usePackaging } from '../packaging'
import { Download, Boxes } from 'lucide-react'

// Inventory Status (V7.13a) — one screen across all three inventory classes
// (metal components, crystals, packaging), showing On-hand / Reserved /
// Available with a reorder flag. Reserved = allocated to confirmed orders;
// Available = On-hand − Reserved is what a new order can draw on.

const CLASSES = ['All', 'Metal', 'Crystal', 'Packaging']
const fmt = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0')

function toCsv(rows) {
  const head = ['Class', 'Code', 'Name', 'Attribute', 'On hand', 'Reserved', 'Available', 'Reorder']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const out = [head.map(esc).join(',')]
  for (const r of rows) out.push([r.cls, r.code, r.name, r.attr, r.onHand, r.reserved, r.available, r.available < 0 ? 'YES' : ''].map(esc).join(','))
  return out.join('\n')
}

export default function InventoryStatus() {
  const { components, loading: lc } = useComponents()
  const { items: crystals, loading: lx } = useCrystals()
  const { items: packaging, loading: lp } = usePackaging()
  const [search, setSearch] = useState('')
  const [cls, setCls] = useState('All')
  const [reorderOnly, setReorderOnly] = useState(false)

  const loading = lc || lx || lp

  const rows = useMemo(() => {
    const mk = (cls, arr, attrKey) => (arr || []).map(c => {
      const onHand = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
      const reserved = Number.isFinite(c.reserved_qty) ? c.reserved_qty : 0
      return { key: `${cls}:${c.id}`, id: c.id, cls, code: c.code || '', name: c.name || '', attr: c[attrKey] || '', onHand, reserved, available: onHand - reserved }
    })
    return [
      ...mk('Metal', components, 'plating_code'),
      ...mk('Crystal', crystals, 'colour'),
      ...mk('Packaging', packaging, 'type'),
    ]
  }, [components, crystals, packaging])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (cls !== 'All' && r.cls !== cls) return false
      if (reorderOnly && r.available >= 0) return false
      if (q && ![r.code, r.name, r.attr].some(v => (v || '').toLowerCase().includes(q))) return false
      return true
    }).sort((a, b) => (a.available - b.available) || a.code.localeCompare(b.code))
  }, [rows, search, cls, reorderOnly])

  const totals = useMemo(() => filtered.reduce((t, r) => {
    t.onHand += r.onHand; t.reserved += r.reserved
    if (r.available < 0) t.reorder += 1
    return t
  }, { onHand: 0, reserved: 0, reorder: 0 }), [filtered])

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'inventory-status.csv'; a.click()
    URL.revokeObjectURL(a.href)
  }

  const BADGE = { Metal: 'bg-ivory text-ink-70', Crystal: 'bg-brand-50 text-brand-700', Packaging: 'bg-sky-50 text-sky-700' }
  const linkFor = r => r.cls === 'Metal' ? `/components/critical/${r.id}` : '/components'

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <h1 className="text-xl font-semibold mb-1 inline-flex items-center gap-2"><Boxes size={20} className="text-brand-500" /> Inventory Status</h1>
      <p className="text-sm text-ink-60 mb-4">
        On-hand, reserved and available across metal components, crystals and packaging.
        <span className="text-ink-50"> Available = On-hand − Reserved</span> — what a new order can draw on. Negative = reorder.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="input text-sm flex-1 min-w-[180px]" placeholder="Search code, name, colour/type…"
               value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input text-sm w-auto" value={cls} onChange={e => setCls(e.target.value)}>
          {CLASSES.map(c => <option key={c} value={c}>{c === 'All' ? 'All classes' : c}</option>)}
        </select>
        <label className="text-xs text-ink-60 inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={reorderOnly} onChange={e => setReorderOnly(e.target.checked)} className="w-3.5 h-3.5 rounded border-gray-300 text-brand-600" />
          Reorder only
        </label>
        <button onClick={exportCsv} disabled={filtered.length === 0} className="text-xs text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 disabled:opacity-40">
          <Download size={13} /> CSV
        </button>
      </div>

      <p className="text-xs text-ink-50 mb-2">
        {loading ? 'Loading…' : (
          <>
            {filtered.length} SKU{filtered.length === 1 ? '' : 's'} · {totals.onHand.toLocaleString()} on hand · <span className="text-amber-600">{totals.reserved.toLocaleString()} reserved</span> · <span className="text-green-700">{(totals.onHand - totals.reserved).toLocaleString()} available</span>
            {totals.reorder > 0 && <> · <span className="text-red-600 font-medium">{totals.reorder} to reorder</span></>}
          </>
        )}
      </p>

      {!loading && filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-60">Nothing matches. Seed stock in the Components tabs first.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-40 border-b border-ivory-dark">
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium text-right">On hand</th>
                  <th className="px-3 py-2 font-medium text-right">Reserved</th>
                  <th className="px-3 py-2 font-medium text-right">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <tr key={r.key} className={r.available < 0 ? 'bg-red-50/40' : 'hover:bg-ivory/40'}>
                    <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${BADGE[r.cls]}`}>{r.cls}</span></td>
                    <td className="px-3 py-2"><Link to={linkFor(r)} className="font-mono text-xs text-brand-600 hover:underline">{r.code}</Link></td>
                    <td className="px-3 py-2 text-xs text-ink-60 truncate max-w-[220px]">{r.name || '—'}{r.attr ? <span className="text-ink-40"> · {r.attr}</span> : ''}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-80">{fmt(r.onHand)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700">{r.reserved ? fmt(r.reserved) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${r.available < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {fmt(r.available)}{r.available < 0 ? ' ⚠' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

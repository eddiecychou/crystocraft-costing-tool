import { useState, useMemo } from 'react'
import { parseStockPaste } from '../inventoryClass'
import StockEditor from './StockEditor'
import StockLedger from './StockLedger'
import { Gem, Box, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'

// Generic stock tab for a simple inventory class (crystals, packaging). Driven
// entirely by an `inv` config (see crystals.js / packaging.js): list + search,
// inline stock editor, expandable per-SKU ledger, add-new, and a paste importer.

const ICONS = { gem: Gem, box: Box }

export default function InventoryStockTab({ inv }) {
  const { items, loading } = inv.useItems()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const Icon = ICONS[inv.iconKey] || Box

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(c => [c.code, c.name, c[inv.attrField], c.size].some(v => (v || '').toLowerCase().includes(q)))
  }, [items, search, inv.attrField])

  const totals = useMemo(() => items.reduce((t, c) => {
    const onHand = Number.isFinite(c.stock_qty) ? c.stock_qty : 0
    const reserved = Number.isFinite(c.reserved_qty) ? c.reserved_qty : 0
    t.onHand += onHand
    t.reserved += reserved
    if (onHand - reserved < 0) t.oversold += 1   // reserved more than on hand → reorder
    return t
  }, { onHand: 0, reserved: 0, oversold: 0 }), [items])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input className="input text-sm flex-1 min-w-[180px]" placeholder={`Search code, name, ${inv.attrLabel.toLowerCase()}…`}
               value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={() => setImporting(true)} className="btn-secondary text-sm">Import stock</button>
        <button onClick={() => setAdding(a => !a)} className="btn-primary text-sm">+ New</button>
      </div>

      {adding && <AddRow inv={inv} onDone={() => setAdding(false)} />}

      <p className="text-xs text-ink-50 mb-2">
        {loading ? 'Loading…' : (
          <>
            {filtered.length} of {items.length} item{items.length === 1 ? '' : 's'} · {totals.onHand.toLocaleString()} on hand
            {totals.reserved > 0 && <> · <span className="text-amber-600">{totals.reserved.toLocaleString()} reserved</span> · <span className="text-green-700">{(totals.onHand - totals.reserved).toLocaleString()} available</span></>}
            {totals.oversold > 0 && <> · <span className="text-red-600 font-medium">{totals.oversold} to reorder</span></>}
          </>
        )}
      </p>

      {!loading && items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-60">
          Nothing here yet. <button onClick={() => setImporting(true)} className="text-brand-600 hover:underline">Import a stock list</button> to seed the master, or add one.
        </div>
      ) : (
        <div className="card divide-y divide-ivory-dark overflow-hidden">
          {filtered.map(c => (
            <div key={c.id}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 hover:bg-ivory/50 transition-colors">
                <button onClick={() => setExpanded(e => e === c.id ? null : c.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  {expanded === c.id ? <ChevronDown size={15} className="text-ink-40 shrink-0" /> : <ChevronRight size={15} className="text-ink-40 shrink-0" />}
                  <Icon size={16} className="text-brand-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-ink-90 truncate">{c.code}</span>
                      {c[inv.attrField] && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 shrink-0">{c[inv.attrField]}</span>}
                      {c.size && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ivory text-ink-60 shrink-0">{c.size}</span>}
                    </div>
                    <p className="text-xs text-ink-60 truncate">
                      {c.name || '—'}
                      {Number(c.reserved_qty) > 0 && (() => {
                        const avail = (Number(c.stock_qty) || 0) - Number(c.reserved_qty)
                        return <span className={avail < 0 ? 'text-red-600 font-medium' : 'text-amber-600'}> · {Number(c.reserved_qty).toLocaleString()} reserved · {avail.toLocaleString()} avail{avail < 0 ? ' — reorder' : ''}</span>
                      })()}
                    </p>
                  </div>
                </button>
                <div className="flex justify-end shrink-0 pl-14 sm:pl-0">
                  <StockEditor component={c} collectionPath={inv.collectionPath} />
                </div>
              </div>
              {expanded === c.id && (
                <div className="px-3 pb-3 bg-ivory/30">
                  <StockLedger componentId={c.id} currentStock={c.stock_qty || 0} currentReserved={c.reserved_qty || 0} collectionPath={inv.collectionPath} />
                  <button onClick={() => { if (window.confirm(`Delete ${c.code}? Its ledger history stays but the SKU is removed.`)) inv.remove(c.id) }}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {importing && <ImportModal inv={inv} onClose={() => setImporting(false)} />}
    </div>
  )
}

function AddRow({ inv, onDone }) {
  const [f, setF] = useState({ code: '', name: '', attr: '', size: '' })
  const [saving, setSaving] = useState(false)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save() {
    if (!f.code.trim()) return
    setSaving(true)
    try { await inv.save(null, { code: f.code, name: f.name, [inv.attrField]: f.attr, size: f.size }); onDone() }
    finally { setSaving(false) }
  }
  return (
    <div className="card p-3 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
      <div><label className="label text-xs">Code *</label><input className="input text-sm font-mono uppercase" value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.toUpperCase() }))} placeholder={inv.codePlaceholder} /></div>
      <div><label className="label text-xs">Name</label><input className="input text-sm" value={f.name} onChange={set('name')} placeholder={inv.namePlaceholder} /></div>
      <div><label className="label text-xs">{inv.attrLabel}</label><input className="input text-sm" value={f.attr} onChange={set('attr')} placeholder={inv.attrPlaceholder} /></div>
      <div className="flex gap-2">
        <input className="input text-sm flex-1" value={f.size} onChange={set('size')} placeholder="Size" />
        <button onClick={save} disabled={saving || !f.code.trim()} className="btn-primary text-sm shrink-0">{saving ? '…' : 'Add'}</button>
      </div>
    </div>
  )
}

function ImportModal({ inv, onClose }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const rows = useMemo(() => parseStockPaste(text), [text])

  async function run() {
    setBusy(true)
    try { setResult(await inv.importStock(rows)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto">
        <h3 className="text-base font-semibold mb-1">Import stock</h3>
        <p className="text-xs text-ink-60 mb-3">
          Paste rows as <span className="font-mono">code · name · qty</span> (tab or comma separated).
          Each row is an absolute count and posts a stock-take to the ledger; re-run any time.
        </p>
        <textarea className="input font-mono text-xs h-40" value={text} onChange={e => setText(e.target.value)}
                  placeholder={inv.importExample} />
        {rows.length > 0 && <p className="text-xs text-ink-60 mt-2">{rows.length} row{rows.length === 1 ? '' : 's'} parsed.</p>}
        {result && <p className="text-sm text-green-700 mt-2">Imported — {result.created} new, {result.updated} updated.</p>}
        <div className="flex justify-end gap-2 mt-4">
          {!result && <button onClick={run} disabled={busy || rows.length === 0} className="btn-primary text-sm">{busy ? 'Importing…' : `Import ${rows.length || ''}`.trim()}</button>}
          <button onClick={onClose} className="btn-secondary text-sm">{result ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  )
}
